from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO

from config import get_settings


@dataclass(frozen=True)
class TextOnlyAssessment:
    use_text_only: bool
    coverage_ratio: float
    image_pages_ratio: float
    reason: str
    warnings: list[str]


def _count_pdf_pages_with_images(pdf_bytes: bytes, max_pages: int) -> tuple[int, int]:
    try:
        from pypdf import PdfReader
    except Exception:
        return 0, 0

    try:
        reader = PdfReader(BytesIO(pdf_bytes))
    except Exception:
        return 0, 0

    n = min(len(reader.pages), max_pages)
    with_images = 0
    for i in range(n):
        try:
            page = reader.pages[i]
            imgs = getattr(page, "images", None)
            if imgs is not None and len(imgs) > 0:
                with_images += 1
        except Exception:
            continue
    return n, with_images


def assess_pdf_text_layer(
    pdf_bytes: bytes,
    pdf_text_by_page: dict[int, str],
    *,
    max_pages: int,
) -> TextOnlyAssessment:
    s = get_settings()
    if s.extraction_text_only_disable:
        return TextOnlyAssessment(
            use_text_only=False,
            coverage_ratio=0.0,
            image_pages_ratio=0.0,
            reason="text_only_disabled",
            warnings=[],
        )

    min_chars = max(1, s.extraction_text_only_min_chars_per_page)
    text_pages = 0
    for i in range(max_pages):
        if len((pdf_text_by_page.get(i) or "").strip()) >= min_chars:
            text_pages += 1
    coverage_ratio = text_pages / max(1, max_pages)
    min_cov = max(0.0, min(1.0, s.extraction_text_only_min_coverage_ratio))

    scanned_pages, image_pages = _count_pdf_pages_with_images(pdf_bytes, max_pages)
    image_ratio = image_pages / max(1, scanned_pages if scanned_pages > 0 else max_pages)
    image_cap = max(0.0, min(1.0, s.extraction_text_only_max_image_pages_ratio))

    warnings: list[str] = []
    if s.extraction_text_only_force:
        warnings.append("Text-only extraction forced by configuration.")
        return TextOnlyAssessment(
            use_text_only=True,
            coverage_ratio=coverage_ratio,
            image_pages_ratio=image_ratio,
            reason="forced",
            warnings=warnings,
        )

    if coverage_ratio < min_cov:
        return TextOnlyAssessment(
            use_text_only=False,
            coverage_ratio=coverage_ratio,
            image_pages_ratio=image_ratio,
            reason="insufficient_text_coverage",
            warnings=warnings,
        )
    if image_ratio > image_cap:
        warnings.append(
            "PDF appears figure-heavy; text-only mode may miss graph/image details."
        )
        # Keep text-only enabled when text coverage is sufficient.
        # Many born-digital PDFs contain embedded image objects (logos/backgrounds)
        # despite having a healthy text layer.
        return TextOnlyAssessment(
            use_text_only=True,
            coverage_ratio=coverage_ratio,
            image_pages_ratio=image_ratio,
            reason="eligible_figure_heavy",
            warnings=warnings,
        )
    return TextOnlyAssessment(
        use_text_only=True,
        coverage_ratio=coverage_ratio,
        image_pages_ratio=image_ratio,
        reason="eligible",
        warnings=warnings,
    )
