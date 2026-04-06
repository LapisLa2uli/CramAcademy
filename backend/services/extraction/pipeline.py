import asyncio
import base64
import logging
from typing import Any, AsyncIterator

from config import get_settings
from schemas.extraction import ExtractionAnalyzeResponse, ExtractionPage
from services.extraction.consistency import collect_warnings
from services.extraction.cross_page import build_page_summaries, cross_page_warning_pass
from services.extraction.normalize import merge_page_results
from services.extraction.openai_extract import extract_page
from services.extraction.pdf_text_hint import extract_pdf_page_texts
from services.extraction.render_pdf import (
    image_file_to_png_bytes,
    pdf_bytes_to_png_pages,
    resize_png_max_edge,
)

logger = logging.getLogger(__name__)

_PDF_SIG = b"%PDF"


def _is_pdf(data: bytes) -> bool:
    return data.startswith(_PDF_SIG)


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
) -> AsyncIterator[dict[str, Any]]:
    """Yield NDJSON-friendly events: ``progress``, optional ``page_image`` chunks, then ``result``."""
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

    effective_two_stage = two_stage or settings.extraction_two_stage_default

    pages = _prepare_pages_from_uploads(
        files, max_pages=limit, max_edge=max_edge, dpi=dpi_val
    )
    if not pages:
        r = ExtractionAnalyzeResponse(warnings=["No pages to analyze."], pages=[], sets=[])
        yield {"type": "result", "data": r.model_dump(mode="json")}
        return

    if settings.ai_provider == "ollama":
        logger.warning("Extraction with Ollama may not support vision; prefer 302ai / OpenAI.")

    total = len(pages)
    yield {"type": "progress", "completed": 0, "total": total}

    sem = asyncio.Semaphore(max(1, settings.extraction_page_concurrency))

    async def one_page(
        idx: int, png: bytes, w: int, h: int
    ) -> tuple[int, dict[str, Any], bytes, int, int, list[str]]:
        async with sem:
            ptext = pdf_text_by_page.get(idx)
            raw, wlocal = await extract_page(
                idx,
                png,
                pdf_page_text=ptext,
                two_stage=effective_two_stage,
            )
        return (idx, raw, png, w, h, wlocal)

    tasks = [
        asyncio.create_task(one_page(i, png, w, h))
        for i, png, w, h in pages
    ]

    page_results: list[tuple[int, dict[str, Any], bytes, int, int]] = []
    warn: list[str] = []
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

    pages_out, sets_out = merge_page_results(page_results)
    warn.extend(collect_warnings(sets_out))

    if settings.extraction_cross_page_warnings and len(page_results) >= 2:
        yield {"type": "status", "phase": "cross_page"}
        summaries = build_page_summaries(page_results)
        try:
            warn.extend(await cross_page_warning_pass(summaries))
        except Exception as e:
            logger.warning("cross_page_warning_pass skipped: %s", e)

    yield {"type": "status", "phase": "encode"}
    stream_edge = settings.extraction_stream_page_image_max_edge_px
    light_pages: list[ExtractionPage] = []
    for (_, _, png_bytes, ow, oh), page in zip(page_results, pages_out, strict=True):
        if stream_edge > 0:
            spng, sw, sh = resize_png_max_edge(png_bytes, stream_edge)
        else:
            spng, sw, sh = png_bytes, ow, oh
        b64 = base64.standard_b64encode(spng).decode("ascii")
        line_payload = {
            "page_index": page.page_index,
            "width_px": sw,
            "height_px": sh,
            "image_base64": b64,
        }
        yield {"type": "page_image", "data": line_payload}
        light_pages.append(
            page.model_copy(
                update={
                    "width_px": sw,
                    "height_px": sh,
                    "image_base64": "",
                }
            )
        )

    r = ExtractionAnalyzeResponse(warnings=warn, pages=light_pages, sets=sets_out)
    payload = r.model_dump(mode="json")
    logger.info(
        "extraction stream: emitted %s page_image line(s) (stream max edge=%s); "
        "final result carries regions/sets only (empty page images)",
        len(light_pages),
        stream_edge if stream_edge > 0 else "full",
    )
    yield {"type": "result", "data": payload}


async def run_analyze(
    files: list[tuple[str, bytes]],
    *,
    max_pages: int | None = None,
    dpi: int | None = None,
    high_accuracy: bool = False,
    two_stage: bool = False,
) -> ExtractionAnalyzeResponse:
    last: ExtractionAnalyzeResponse | None = None
    page_images: dict[int, dict[str, Any]] = {}
    async for ev in iter_analyze(
        files,
        max_pages=max_pages,
        dpi=dpi,
        high_accuracy=high_accuracy,
        two_stage=two_stage,
    ):
        if ev.get("type") == "page_image":
            d = ev.get("data")
            if isinstance(d, dict):
                idx = d.get("page_index")
                if isinstance(idx, int):
                    page_images[idx] = d
        elif ev.get("type") == "result":
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
        wp, hp = d.get("width_px"), d.get("height_px")
        merged_pages.append(
            p.model_copy(
                update={
                    "image_base64": b64 if isinstance(b64, str) else "",
                    "width_px": int(wp) if isinstance(wp, (int, float)) else p.width_px,
                    "height_px": int(hp) if isinstance(hp, (int, float)) else p.height_px,
                }
            )
        )
    return last.model_copy(update={"pages": merged_pages})
