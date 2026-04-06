import asyncio
import logging
from typing import Any, AsyncIterator

from config import get_settings
from schemas.extraction import ExtractionAnalyzeResponse
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
    """Yield NDJSON-friendly events: ``progress`` then ``result``."""
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

    pages_out, sets_out = merge_page_results(page_results)
    warn.extend(collect_warnings(sets_out))

    if settings.extraction_cross_page_warnings and len(page_results) >= 2:
        summaries = build_page_summaries(page_results)
        try:
            warn.extend(await cross_page_warning_pass(summaries))
        except Exception as e:
            logger.warning("cross_page_warning_pass skipped: %s", e)

    r = ExtractionAnalyzeResponse(warnings=warn, pages=pages_out, sets=sets_out)
    yield {"type": "result", "data": r.model_dump(mode="json")}


async def run_analyze(
    files: list[tuple[str, bytes]],
    *,
    max_pages: int | None = None,
    dpi: int | None = None,
    high_accuracy: bool = False,
    two_stage: bool = False,
) -> ExtractionAnalyzeResponse:
    last: ExtractionAnalyzeResponse | None = None
    async for ev in iter_analyze(
        files,
        max_pages=max_pages,
        dpi=dpi,
        high_accuracy=high_accuracy,
        two_stage=two_stage,
    ):
        if ev.get("type") == "result":
            last = ExtractionAnalyzeResponse.model_validate(ev["data"])
    if last is None:
        raise RuntimeError("Extraction produced no result.")
    return last
