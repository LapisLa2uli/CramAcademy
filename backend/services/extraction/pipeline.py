import asyncio
import base64
import json
import logging
from typing import Any, AsyncIterator

from config import get_settings
from schemas.extraction import ExtractionAnalyzeResponse, ExtractionPage, PdfDocumentProfile
from services.extraction.ap_extraction_postprocess import apply_canonical_postprocess
from services.extraction.ap_extraction_validate import validate_extraction_structure
from services.extraction.consistency import collect_warnings
from services.extraction.cross_page import build_page_summaries, cross_page_warning_pass
from services.extraction.normalize import merge_page_results
from services.extraction.openai_extract import extract_page, extract_page_from_text
from services.extraction.pdf_document_profile import build_document_profile
from services.extraction.pdf_text_hint import extract_pdf_page_texts
from services.extraction.text_only_mode import assess_pdf_text_layer
from services.extraction.render_pdf import (
    image_file_to_png_bytes,
    pdf_bytes_to_png_pages,
    pdf_bytes_to_single_png_page,
    prepare_extraction_stream_image,
    resize_png_max_edge,
)

logger = logging.getLogger(__name__)

_PDF_SIG = b"%PDF"


def _is_pdf(data: bytes) -> bool:
    return data.startswith(_PDF_SIG)


def _finalize_page_image_wire_record(meta: dict[str, Any], b64: str) -> dict[str, Any]:
    """Normalize a completed page_image (chunked or single) for run_analyze merge."""
    fmt = meta.get("format", "png")
    return {
        "page_index": int(meta["page_index"]),
        "width_px": meta["width_px"],
        "height_px": meta["height_px"],
        "image_base64": b64,
        "format": fmt,
    }


def _prepare_pages_from_uploads(
    files: list[tuple[str, bytes]],
    *,
    max_pages: int,
    max_edge: int,
    dpi: int,
) -> list[tuple[int, bytes, int, int]]:
    """Returns list of (page_index, png_bytes, w, h)."""
    if not files:
        return []

    if len(files) == 1 and _is_pdf(files[0][1]):
        pngs = pdf_bytes_to_png_pages(files[0][1], max_pages=max_pages, dpi=dpi)
        out: list[tuple[int, bytes, int, int]] = []
        for i, png in enumerate(pngs):
            resized, w, h = resize_png_max_edge(png, max_edge)
            out.append((i, resized, w, h))
        return out

    out2: list[tuple[int, bytes, int, int]] = []
    for i, (_, raw) in enumerate(files[:max_pages]):
        png = image_file_to_png_bytes(raw)
        resized, w, h = resize_png_max_edge(png, max_edge)
        out2.append((i, resized, w, h))
    return out2


async def iter_analyze(
    files: list[tuple[str, bytes]],
    *,
    max_pages: int | None = None,
    dpi: int | None = None,
    high_accuracy: bool = False,
    two_stage: bool = False,
    layout_only: bool = False,
) -> AsyncIterator[dict[str, Any]]:
    """Yield NDJSON: ``progress``, ``page_image`` (or begin/part/end), ``result`` or ``result_b64_*``."""
    settings = get_settings()
    if not settings.extraction_enabled:
        raise RuntimeError("Extraction is disabled (EXTRACTION_ENABLED=false).")

    limit = max_pages if max_pages is not None else settings.extraction_max_pages
    limit = min(limit, settings.extraction_max_pages)
    dpi_val = dpi if dpi is not None else settings.extraction_default_dpi
    max_edge = settings.extraction_max_image_edge_px
    if high_accuracy:
        max_edge = max(max_edge, settings.extraction_high_accuracy_max_edge_px)
        dpi_val = max(dpi_val, 200)

    pdf_text_by_page: dict[int, str] = {}
    if settings.extraction_pdf_text_hint and len(files) == 1 and _is_pdf(files[0][1]):
        pdf_text_by_page = extract_pdf_page_texts(files[0][1], max_pages=limit)

    effective_two_stage = (
        two_stage
        or settings.extraction_two_stage_default
        or (settings.ai_provider == "ollama" and settings.extraction_ollama_two_stage_default)
    ) and not layout_only

    use_text_only = False
    text_only_warnings: list[str] = []
    if (
        settings.extraction_text_only_enabled
        and len(files) == 1
        and _is_pdf(files[0][1])
        and not layout_only
        and pdf_text_by_page
    ):
        assess = assess_pdf_text_layer(
            files[0][1], pdf_text_by_page, max_pages=limit
        )
        use_text_only = assess.use_text_only
        text_only_warnings.extend(assess.warnings)
        if use_text_only:
            text_only_warnings.append(
                "Text-only extraction mode used (no vision model calls)."
            )
    yield {"type": "status", "phase": "mode", "mode": "text" if use_text_only else "vision"}

    pages = _prepare_pages_from_uploads(
        files, max_pages=limit, max_edge=max_edge, dpi=dpi_val
    )
    if not pages:
        r = ExtractionAnalyzeResponse(warnings=["No pages to analyze."], pages=[], sets=[])
        yield {"type": "result", "data": r.model_dump(mode="json")}
        return

    doc_profile: PdfDocumentProfile | None = None
    if len(files) == 1 and _is_pdf(files[0][1]) and pdf_text_by_page:
        doc_profile = build_document_profile(pdf_text_by_page, max_pages_index=len(pages))
        if not settings.extraction_skip_noncontent_pages:
            doc_profile = doc_profile.model_copy(
                update={
                    "pages": [
                        p.model_copy(update={"extract_vision": True}) for p in doc_profile.pages
                    ]
                }
            )

    if settings.ai_provider == "ollama":
        logger.warning(
            "Server-side extraction uses Ollama — use a vision model tag on EXTRACTION_MODEL / "
            "OLLAMA_MODEL (e.g. qwen2.5vl:7b, llama3.2-vision, llava:7b), not a text-only tag like llama3."
        )

    total = len(pages)
    yield {"type": "progress", "completed": 0, "total": total}

    sem = asyncio.Semaphore(max(1, settings.extraction_page_concurrency))

    prof_hint = doc_profile.hint_for_vision() if doc_profile else None

    async def one_page(
        idx: int, png: bytes, w: int, h: int
    ) -> tuple[int, dict[str, Any], bytes, int, int, list[str]]:
        wlocal: list[str] = []
        skip = (
            doc_profile is not None
            and idx < len(doc_profile.pages)
            and not doc_profile.pages[idx].extract_vision
        )
        if skip and not layout_only:
            assert doc_profile is not None
            role = doc_profile.pages[idx].role
            wlocal.append(
                f"Page {idx + 1}: skipped vision extraction ({role}) — non-questionnaire page."
            )
            return (idx, {"regions": [], "sets": []}, png, w, h, wlocal)
        async with sem:
            ptext = pdf_text_by_page.get(idx) if not layout_only else None
            fam = doc_profile.family if doc_profile else None
            role = (
                doc_profile.pages[idx].role
                if doc_profile is not None and idx < len(doc_profile.pages)
                else None
            )
            if use_text_only and ptext:
                raw, wlocal2 = await extract_page_from_text(
                    idx,
                    page_text=ptext,
                    previous_page_text=pdf_text_by_page.get(idx - 1),
                    next_page_text=pdf_text_by_page.get(idx + 1),
                    document_profile_hint=prof_hint,
                    use_llm=settings.extraction_text_only_use_llm,
                )
            else:
                raw, wlocal2 = await extract_page(
                    idx,
                    png,
                    pdf_page_text=ptext,
                    document_profile_hint=prof_hint,
                    document_family=fam,
                    page_pdf_role=role,
                    two_stage=effective_two_stage,
                    layout_only=layout_only,
                )
        wlocal.extend(wlocal2)
        return (idx, raw, png, w, h, wlocal)

    tasks = [
        asyncio.create_task(one_page(i, png, w, h))
        for i, png, w, h in pages
    ]

    page_results: list[tuple[int, dict[str, Any], bytes, int, int]] = []
    warn: list[str] = []
    warn.extend(text_only_warnings)
    done = 0
    for fut in asyncio.as_completed(tasks):
        try:
            idx, raw, png, w, h, wloc = await fut
            page_results.append((idx, raw, png, w, h))
            warn.extend(wloc)
        except BaseException as e:
            warn.append(f"Page failed: {e}")
        done += 1
        yield {"type": "progress", "completed": done, "total": total}

    page_results.sort(key=lambda x: x[0])

    # Keep the HTTP stream alive through merge / LLM / huge json.dumps — proxies often
    # close “idle” connections if no bytes are sent for tens of seconds.
    yield {"type": "status", "phase": "merge"}

    pages_out, sets_out, stitch_events = merge_page_results(page_results)

    if doc_profile is not None and pdf_text_by_page:
        sets_out = apply_canonical_postprocess(
            sets_out, doc_profile, pdf_text_by_page, max_page=len(pages)
        )
    struct_warnings: list[str] = []
    retry_pages: list[int] = []
    if doc_profile is not None:
        struct_warnings, retry_pages = validate_extraction_structure(sets_out, doc_profile)

    if (
        settings.extraction_auto_retry_fail_pages
        and retry_pages
        and len(files) == 1
        and _is_pdf(files[0][1])
        and doc_profile is not None
        and doc_profile.family == "college_board_calc"
        and not layout_only
    ):
        dpi_retry = max(dpi_val + 40, settings.extraction_retry_dpi_min)
        if dpi_retry > dpi_val:
            warn.append(
                f"Re-extracting {len(retry_pages)} page(s) at DPI {dpi_retry} after calculus integrity checks."
            )
            pdf_blob = files[0][1]
            to_retry = [i for i in retry_pages[:16] if i >= 0]

            def _tuple_for_page(pi: int):
                for tup in page_results:
                    if tup[0] == pi:
                        return tup
                return None

            async def _redo_one(
                i: int,
            ) -> tuple[int, dict[str, Any], bytes, int, int, list[str]]:
                prev = _tuple_for_page(i)
                async with sem:
                    try:
                        png_hi = pdf_bytes_to_single_png_page(
                            pdf_blob, page_index=i, dpi=dpi_retry
                        )
                        png_hi, rw, rh = resize_png_max_edge(png_hi, max_edge)
                    except Exception as e:
                        if prev:
                            return (
                                i,
                                prev[1],
                                prev[2],
                                prev[3],
                                prev[4],
                                [f"Page {i + 1}: retry render failed ({e})."],
                            )
                        return (i, {"regions": [], "sets": []}, b"", 0, 0, [f"Page {i + 1}: retry failed ({e})."])
                    ptext = pdf_text_by_page.get(i) if not layout_only else None
                    rfam = doc_profile.family if doc_profile else None
                    rrole = (
                        doc_profile.pages[i].role
                        if doc_profile is not None and i < len(doc_profile.pages)
                        else None
                    )
                    raw_r, wl = await extract_page(
                        i,
                        png_hi,
                        pdf_page_text=ptext,
                        document_profile_hint=prof_hint,
                        document_family=rfam,
                        page_pdf_role=rrole,
                        two_stage=effective_two_stage,
                        layout_only=layout_only,
                    )
                return (i, raw_r, png_hi, rw, rh, wl)

            retry_tasks = [asyncio.create_task(_redo_one(i)) for i in to_retry]
            if retry_tasks:
                for row in await asyncio.gather(*retry_tasks):
                    i, raw_r, png_hi, rw, rh, wl = row
                    for j, tup in enumerate(page_results):
                        if tup[0] == i:
                            page_results[j] = (i, raw_r, png_hi, rw, rh)
                            break
                    warn.extend(wl)
                page_results.sort(key=lambda x: x[0])
                pages_out, sets_out, stitch_events = merge_page_results(page_results)
                if doc_profile is not None and pdf_text_by_page:
                    sets_out = apply_canonical_postprocess(
                        sets_out, doc_profile, pdf_text_by_page, max_page=len(pages)
                    )
                struct_warnings, retry_pages = validate_extraction_structure(sets_out, doc_profile)

    warn.extend(struct_warnings)

    for ev in stitch_events:
        pages_1based = [p + 1 for p in ev["source_page_indices"]]
        logger.info(
            "extraction stitch: merged set %s across pages %s (reason=%s, question_bridge=%s)",
            ev["target_set_index"],
            pages_1based,
            ev["reason"],
            ev["question_bridge"],
        )
        warn.append(
            "Stitched multi-page set "
            + str(ev["target_set_index"] + 1)
            + " across pages "
            + ", ".join(str(p) for p in pages_1based)
            + (" (question spanned page break)" if ev["question_bridge"] else "")
            + "."
        )
        yield {
            "type": "stitch",
            "data": {
                "target_set_index": ev["target_set_index"],
                "source_page_indices": ev["source_page_indices"],
                "reason": ev["reason"],
                "question_bridge": ev["question_bridge"],
            },
        }
    warn.extend(collect_warnings(sets_out))

    if (
        settings.extraction_cross_page_warnings
        and len(page_results) >= 2
        and not layout_only
    ):
        yield {"type": "status", "phase": "cross_page"}
        summaries = build_page_summaries(page_results)
        try:
            warn.extend(await cross_page_warning_pass(summaries))
        except Exception as e:
            logger.warning("cross_page_warning_pass skipped: %s", e)

    yield {"type": "status", "phase": "encode"}
    stream_edge = settings.extraction_stream_page_image_max_edge_px
    chunk_lim = max(4096, settings.extraction_stream_b64_chunk_chars)
    light_pages: list[ExtractionPage] = []
    page_image_line_count = 0
    for (_, _, png_bytes, _ow, _oh), page in zip(page_results, pages_out, strict=True):
        edge = stream_edge if stream_edge > 0 else 0
        enc, mime, sw, sh = prepare_extraction_stream_image(
            png_bytes,
            max_edge=edge,
            use_jpeg=settings.extraction_stream_page_use_jpeg,
            jpeg_quality=settings.extraction_stream_page_jpeg_quality,
        )
        fmt = "jpeg" if mime == "image/jpeg" else "png"
        b64 = base64.standard_b64encode(enc).decode("ascii")
        base_fields: dict[str, Any] = {
            "page_index": page.page_index,
            "width_px": sw,
            "height_px": sh,
            "format": fmt,
        }
        if len(b64) <= chunk_lim:
            yield {"type": "page_image", "data": {**base_fields, "image_base64": b64}}
            page_image_line_count += 1
        else:
            n = (len(b64) + chunk_lim - 1) // chunk_lim
            yield {"type": "page_image_begin", "data": {**base_fields, "parts": n}}
            page_image_line_count += 1
            for pi, start in enumerate(range(0, len(b64), chunk_lim)):
                yield {
                    "type": "page_image_part",
                    "data": {
                        "page_index": page.page_index,
                        "part": pi,
                        "b64": b64[start : start + chunk_lim],
                    },
                }
                page_image_line_count += 1
            yield {"type": "page_image_end", "data": {"page_index": page.page_index}}
            page_image_line_count += 1

        light_pages.append(
            page.model_copy(
                update={
                    "width_px": sw,
                    "height_px": sh,
                    "image_base64": "",
                }
            )
        )

    r = ExtractionAnalyzeResponse(
        warnings=warn,
        pages=light_pages,
        sets=sets_out,
        document_profile=doc_profile,
    )
    payload = r.model_dump(mode="json")
    json_str = json.dumps(payload, ensure_ascii=False)
    th = settings.extraction_stream_result_json_char_threshold
    if len(json_str) <= th:
        logger.info(
            "extraction stream: %s page_image-related line(s), max edge=%s, jpeg=%s; "
            "single result JSON (%s chars)",
            page_image_line_count,
            stream_edge if stream_edge > 0 else "full",
            settings.extraction_stream_page_use_jpeg,
            len(json_str),
        )
        yield {"type": "result", "data": payload}
    else:
        out_b64 = base64.standard_b64encode(json_str.encode("utf-8")).decode("ascii")
        nchunks = (len(out_b64) + chunk_lim - 1) // chunk_lim
        logger.info(
            "extraction stream: %s page_image-related line(s); sharded result JSON "
            "(%s chars -> %s base64 chunks)",
            page_image_line_count,
            len(json_str),
            nchunks,
        )
        yield {"type": "result_b64_begin", "parts": nchunks}
        for i in range(0, len(out_b64), chunk_lim):
            yield {"type": "result_b64_part", "data": out_b64[i : i + chunk_lim]}
        yield {"type": "result_b64_end"}


async def run_analyze(
    files: list[tuple[str, bytes]],
    *,
    max_pages: int | None = None,
    dpi: int | None = None,
    high_accuracy: bool = False,
    two_stage: bool = False,
    layout_only: bool = False,
) -> ExtractionAnalyzeResponse:
    last: ExtractionAnalyzeResponse | None = None
    page_images: dict[int, dict[str, Any]] = {}
    pim_meta: dict[int, dict[str, Any]] = {}
    pim_parts: dict[int, dict[int, str]] = {}
    result_b64_fragments: list[str] = []

    async for ev in iter_analyze(
        files,
        max_pages=max_pages,
        dpi=dpi,
        high_accuracy=high_accuracy,
        two_stage=two_stage,
        layout_only=layout_only,
    ):
        t = ev.get("type")
        if t == "page_image_begin":
            d = ev.get("data")
            if isinstance(d, dict) and isinstance(d.get("page_index"), int):
                idx = int(d["page_index"])
                pim_meta[idx] = {
                    "page_index": idx,
                    "width_px": d["width_px"],
                    "height_px": d["height_px"],
                    "format": d.get("format", "png"),
                }
                pim_parts[idx] = {}
        elif t == "page_image_part":
            d = ev.get("data")
            if isinstance(d, dict) and isinstance(d.get("page_index"), int):
                idx = int(d["page_index"])
                part = d.get("part")
                b64p = d.get("b64")
                if isinstance(part, int) and isinstance(b64p, str):
                    pim_parts.setdefault(idx, {})[part] = b64p
        elif t == "page_image_end":
            d = ev.get("data")
            if isinstance(d, dict) and isinstance(d.get("page_index"), int):
                idx = int(d["page_index"])
                meta = pim_meta.pop(idx, {})
                parts_map = pim_parts.pop(idx, {})
                b64 = "".join(parts_map[i] for i in sorted(parts_map))
                if meta:
                    page_images[idx] = _finalize_page_image_wire_record(meta, b64)
        elif t == "page_image":
            d = ev.get("data")
            if isinstance(d, dict) and isinstance(d.get("page_index"), int):
                idx = int(d["page_index"])
                b64 = d.get("image_base64")
                if isinstance(b64, str):
                    page_images[idx] = _finalize_page_image_wire_record(
                        {
                            "page_index": idx,
                            "width_px": d["width_px"],
                            "height_px": d["height_px"],
                            "format": d.get("format", "png"),
                        },
                        b64,
                    )
        elif t == "result_b64_begin":
            result_b64_fragments.clear()
        elif t == "result_b64_part":
            frag = ev.get("data")
            if isinstance(frag, str):
                result_b64_fragments.append(frag)
        elif t == "result_b64_end":
            blob = base64.standard_b64decode("".join(result_b64_fragments))
            last = ExtractionAnalyzeResponse.model_validate_json(blob.decode("utf-8"))
        elif t == "result":
            last = ExtractionAnalyzeResponse.model_validate(ev["data"])
    if last is None:
        raise RuntimeError("Extraction produced no result.")
    if not page_images:
        return last
    merged_pages: list[ExtractionPage] = []
    for p in last.pages:
        d = page_images.get(p.page_index)
        if not d:
            merged_pages.append(p)
            continue
        b64 = d.get("image_base64")
        if not isinstance(b64, str):
            b64 = ""
        fmt = d.get("format", "png")
        if fmt == "jpeg" and b64 and not b64.startswith("data:"):
            b64 = f"data:image/jpeg;base64,{b64}"
        wp, hp = d.get("width_px"), d.get("height_px")
        merged_pages.append(
            p.model_copy(
                update={
                    "image_base64": b64,
                    "width_px": int(wp) if isinstance(wp, (int, float)) else p.width_px,
                    "height_px": int(hp) if isinstance(hp, (int, float)) else p.height_px,
                }
            )
        )
    return last.model_copy(update={"pages": merged_pages})
