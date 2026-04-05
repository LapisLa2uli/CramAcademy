import asyncio
import logging
from typing import Any

from config import get_settings
from schemas.extraction import ExtractionAnalyzeResponse
from services.extraction.consistency import collect_warnings
from services.extraction.normalize import merge_page_results
from services.extraction.openai_extract import extract_page
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

    # Single PDF
    if len(files) == 1 and _is_pdf(files[0][1]):
        pngs = pdf_bytes_to_png_pages(files[0][1], max_pages=max_pages, dpi=dpi)
        out: list[tuple[int, bytes, int, int]] = []
        for i, png in enumerate(pngs):
            resized, w, h = resize_png_max_edge(png, max_edge)
            out.append((i, resized, w, h))
        return out

    # One or more images → one page each
    out2: list[tuple[int, bytes, int, int]] = []
    for i, (_, raw) in enumerate(files[:max_pages]):
        png = image_file_to_png_bytes(raw)
        resized, w, h = resize_png_max_edge(png, max_edge)
        out2.append((i, resized, w, h))
    return out2


async def run_analyze(
    files: list[tuple[str, bytes]],
    *,
    max_pages: int | None = None,
    dpi: int = 160,
) -> ExtractionAnalyzeResponse:
    settings = get_settings()
    if not settings.extraction_enabled:
        raise RuntimeError("Extraction is disabled (EXTRACTION_ENABLED=false).")

    limit = max_pages if max_pages is not None else settings.extraction_max_pages
    limit = min(limit, settings.extraction_max_pages)
    max_edge = settings.extraction_max_image_edge_px

    pages = _prepare_pages_from_uploads(
        files, max_pages=limit, max_edge=max_edge, dpi=dpi
    )
    if not pages:
        return ExtractionAnalyzeResponse(warnings=["No pages to analyze."], pages=[], sets=[])

    if settings.ai_provider == "ollama":
        logger.warning("Extraction with Ollama may not support vision; prefer 302ai / OpenAI.")

    sem = asyncio.Semaphore(max(1, settings.extraction_page_concurrency))

    async def one_page(idx: int, png: bytes, w: int, h: int) -> tuple[int, dict[str, Any], bytes, int, int]:
        async with sem:
            raw = await extract_page(idx, png)
            return (idx, raw, png, w, h)

    results = await asyncio.gather(
        *[one_page(i, png, w, h) for i, png, w, h in pages],
        return_exceptions=True,
    )

    page_results: list[tuple[int, dict[str, Any], bytes, int, int]] = []
    warn: list[str] = []
    for r in results:
        if isinstance(r, BaseException):
            warn.append(f"Page failed: {r}")
            continue
        page_results.append(r)

    page_results.sort(key=lambda x: x[0])
    pages_out, sets_out = merge_page_results(page_results)
    warn.extend(collect_warnings(sets_out))
    return ExtractionAnalyzeResponse(warnings=warn, pages=pages_out, sets=sets_out)
