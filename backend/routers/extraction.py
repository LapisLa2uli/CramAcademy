import json

from fastapi import APIRouter, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from config import get_settings
from database import get_supabase_admin
from schemas.extraction import (
    ExtractionAnalyzeResponse,
    ExtractionCommitRequest,
    ExtractionCommitResponse,
)
from schemas.question import QuestionCreate, QuestionType
from services.authz import get_bearer_user_id
from services.extraction.pipeline import iter_analyze, run_analyze
from services.question_validation import validate_question

router = APIRouter()

_MAX_TOTAL_BYTES = 48 * 1024 * 1024
_PDF_SIG = b"%PDF"


def _is_pdf(data: bytes) -> bool:
    return data.startswith(_PDF_SIG)


async def _load_extraction_files(files: list[UploadFile]) -> list[tuple[str, bytes]]:
    if not files:
        raise HTTPException(status_code=422, detail="No files uploaded.")

    chunks: list[tuple[str, bytes]] = []
    total = 0
    for f in files:
        raw = await f.read()
        total += len(raw)
        if total > _MAX_TOTAL_BYTES:
            raise HTTPException(status_code=413, detail="Total upload size too large.")
        chunks.append((f.filename or "upload", raw))

    pdf_count = sum(1 for _, b in chunks if _is_pdf(b))
    if pdf_count > 1:
        raise HTTPException(status_code=400, detail="Upload at most one PDF.")
    if pdf_count == 1 and len(chunks) > 1:
        raise HTTPException(
            status_code=400,
            detail="Upload either a single PDF or one or more images — not both.",
        )
    return chunks


@router.post("/analyze", response_model=ExtractionAnalyzeResponse)
async def extraction_analyze(
    authorization: str = Header(...),
    files: list[UploadFile] = File(...),
    max_pages: int = Form(20),
    dpi: int = Form(160),
):
    settings = get_settings()
    if not settings.extraction_enabled:
        raise HTTPException(status_code=503, detail="Extraction is disabled.")

    get_bearer_user_id(authorization)
    chunks = await _load_extraction_files(files)

    try:
        return await run_analyze(chunks, max_pages=max_pages, dpi=dpi)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e


@router.post("/analyze-stream")
async def extraction_analyze_stream(
    authorization: str = Header(...),
    files: list[UploadFile] = File(...),
    max_pages: int = Form(20),
    dpi: int = Form(160),
):
    """NDJSON stream: ``progress`` lines then final ``result`` (same payload as ``/analyze``)."""
    settings = get_settings()
    if not settings.extraction_enabled:
        raise HTTPException(status_code=503, detail="Extraction is disabled.")

    get_bearer_user_id(authorization)
    chunks = await _load_extraction_files(files)

    async def ndjson_body():
        try:
            async for ev in iter_analyze(chunks, max_pages=max_pages, dpi=dpi):
                yield (json.dumps(ev, ensure_ascii=False) + "\n").encode("utf-8")
        except RuntimeError as e:
            err = json.dumps({"type": "error", "detail": str(e)}, ensure_ascii=False) + "\n"
            yield err.encode("utf-8")

    return StreamingResponse(
        ndjson_body(),
        media_type="application/x-ndjson",
    )


@router.post("/commit", response_model=ExtractionCommitResponse)
async def extraction_commit(
    body: ExtractionCommitRequest,
    authorization: str = Header(...),
):
    settings = get_settings()
    if not settings.extraction_enabled:
        raise HTTPException(status_code=503, detail="Extraction is disabled.")

    user_id = get_bearer_user_id(authorization)
    admin = get_supabase_admin()

    if not body.subject.strip():
        raise HTTPException(status_code=422, detail="Subject name is required.")

    created_ids: list[str] = []
    counts: list[int] = []

    tags = body.tags or []

    for s in body.sets:
        if not s.questions:
            continue

        ctx = (s.context_text or "").strip()
        img = (s.context_image_url or "").strip()
        if not ctx and not img:
            ctx = "(No shared passage extracted — see individual questions.)"

        sr = admin.table("question_sets").insert(
            {
                "creator_id": user_id,
                "context_text": ctx,
                "context_image_url": s.context_image_url if s.context_image_url else None,
            }
        ).execute()
        if not sr.data:
            raise HTTPException(status_code=500, detail="Failed to create question set.")
        set_id = sr.data[0]["id"]
        created_ids.append(set_id)

        nq = 0
        for item in s.questions:
            opts = item.options
            if item.type == "mcq" and opts:
                opts = [
                    o
                    for o in opts
                    if isinstance(o, dict)
                    and (str(o.get("text", "")).strip() or o.get("image_url"))
                ]

            ans = item.answer.strip()
            if item.type == "mcq":
                ans = ans.upper()[:1] if ans else ans

            q = QuestionCreate(
                type=QuestionType.mcq if item.type == "mcq" else QuestionType.frq,
                subject=body.subject.strip(),
                subject_id=body.subject_id,
                course_level=body.course_level,
                grade_level=body.grade_level,
                content=item.content or "",
                latex_enabled=item.latex_enabled,
                options=opts if item.type == "mcq" else None,
                answer=ans,
                explanation=item.explanation,
                rubric=item.rubric,
                tags=tags,
            )
            errs = validate_question(q)
            if errs:
                raise HTTPException(
                    status_code=422,
                    detail={"set_id": set_id, "errors": errs},
                )

            data = q.model_dump(mode="json", exclude_none=True)
            data["creator_id"] = user_id
            data["validated"] = False
            data["pool"] = "personal"
            data["question_set_id"] = set_id

            existing = (
                admin.table("questions")
                .select("position_in_set")
                .eq("question_set_id", set_id)
                .order("position_in_set", desc=True)
                .limit(1)
                .execute()
            )
            next_pos = 0
            if existing.data and existing.data[0].get("position_in_set") is not None:
                next_pos = int(existing.data[0]["position_in_set"]) + 1
            data["position_in_set"] = next_pos

            if "type" in data and hasattr(data["type"], "value"):
                data["type"] = data["type"].value

            ins = admin.table("questions").insert(data).execute()
            if not ins.data:
                raise HTTPException(status_code=500, detail="Failed to insert question.")
            nq += 1

        counts.append(nq)

    return ExtractionCommitResponse(created_set_ids=created_ids, question_counts=counts)
