from typing import Optional

from fastapi import APIRouter, HTTPException, Header, Query
from datetime import datetime, timezone
from schemas.test import TestGenerateRequest, TestResponse, TestDetailResponse
from services.test_generation import generate_test_questions
from database import get_supabase_admin
from services.authz import get_bearer_user_id

router = APIRouter()


def _attach_question_set_context(admin, questions: list[dict]) -> None:
    set_ids = {q["question_set_id"] for q in questions if q.get("question_set_id")}
    set_context: dict[str, dict] = {}
    for sid in set_ids:
        sr = admin.table("question_sets").select("*").eq("id", sid).execute()
        if sr.data:
            set_context[sid] = sr.data[0]
    for q in questions:
        sid = q.get("question_set_id")
        if sid and sid in set_context:
            q["context_text"] = set_context[sid].get("context_text", "")
            q["context_image_url"] = set_context[sid].get("context_image_url")


@router.get("", response_model=list[TestResponse])
async def list_tests(
    authorization: str = Header(...),
    limit: int = Query(50, ge=1, le=100),
):
    user_id = get_bearer_user_id(authorization)
    admin = get_supabase_admin()
    r = (
        admin.table("tests")
        .select("*")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    return r.data or []


@router.get("/wrong-book", response_model=list[dict])
async def get_wrong_book(
    subject: str,
    authorization: str = Header(...),
    course_level: Optional[str] = None,
    grade_level: Optional[int] = Query(None, ge=1, le=12),
):
    """Questions the user missed (is_correct false), with latest attempt metadata and set context."""
    user_id = get_bearer_user_id(authorization)
    admin = get_supabase_admin()

    subs = (
        admin.table("submissions")
        .select("id, test_id, question_id, created_at")
        .eq("user_id", user_id)
        .eq("is_correct", False)
        .execute()
    )
    rows = subs.data or []
    if not rows:
        return []

    qids = list({r["question_id"] for r in rows if r.get("question_id")})
    if not qids:
        return []

    qres = admin.table("questions").select("*").in_("id", qids).eq("subject", subject).execute()
    questions_by_id = {q["id"]: q for q in (qres.data or [])}

    by_q: dict[str, dict] = {}
    for r in sorted(rows, key=lambda x: x.get("created_at") or ""):
        qid = r.get("question_id")
        if not qid or qid not in questions_by_id:
            continue
        q = questions_by_id[qid]
        if course_level and q.get("course_level") != course_level:
            continue
        if grade_level is not None and q.get("grade_level") != grade_level:
            continue
        by_q[qid] = r

    out: list[dict] = []
    for qid, sub_row in by_q.items():
        q = dict(questions_by_id[qid])
        out.append({
            "question": q,
            "submission_id": sub_row["id"],
            "test_id": sub_row["test_id"],
            "created_at": sub_row["created_at"],
        })

    _attach_question_set_context(admin, [item["question"] for item in out])
    return out


@router.post("/generate", response_model=TestDetailResponse)
async def generate_test(
    req: TestGenerateRequest,
    authorization: str = Header(...),
):
    user_id = get_bearer_user_id(authorization)

    questions = await generate_test_questions(
        user_id=user_id,
        subject=req.subject,
        num_questions=req.num_questions,
        course_level=req.course_level,
        grade_level=req.grade_level,
        question_source=req.question_source,
        question_type=req.question_type,
    )

    if not questions:
        raise HTTPException(
            status_code=404,
            detail="No questions found matching the criteria",
        )

    admin = get_supabase_admin()

    test_result = admin.table("tests").insert({
        "user_id": user_id,
        "subject": req.subject,
        "course_level": req.course_level,
        "grade_level": req.grade_level,
        "time_limit_seconds": req.time_limit_seconds,
    }).execute()

    test = test_result.data[0]
    test_id = test["id"]

    test_questions = [
        {"test_id": test_id, "question_id": q["id"], "position": i}
        for i, q in enumerate(questions)
    ]
    admin.table("test_questions").insert(test_questions).execute()

    return {**test, "questions": questions}


@router.get("/{test_id}", response_model=TestDetailResponse)
async def get_test(test_id: str, authorization: str = Header(...)):
    user_id = get_bearer_user_id(authorization)
    admin = get_supabase_admin()

    test_result = admin.table("tests").select("*").eq("id", test_id).eq("user_id", user_id).execute()
    if not test_result.data:
        raise HTTPException(status_code=404, detail="Test not found")

    test = test_result.data[0]

    tq_result = (
        admin.table("test_questions")
        .select("question_id, position, questions(*)")
        .eq("test_id", test_id)
        .order("position")
        .execute()
    )

    questions = [
        {**tq["questions"], "position": tq["position"]}
        for tq in (tq_result.data or [])
    ]

    _attach_question_set_context(admin, questions)

    return {**test, "questions": questions}


@router.post("/{test_id}/start")
async def start_test(test_id: str, authorization: str = Header(...)):
    user_id = get_bearer_user_id(authorization)
    admin = get_supabase_admin()

    admin.table("tests").update({
        "started_at": datetime.now(timezone.utc).isoformat()
    }).eq("id", test_id).eq("user_id", user_id).execute()

    return {"status": "started"}
