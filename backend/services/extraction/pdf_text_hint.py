"""Extract embedded text from PDF bytes per page (hint for vision; image stays ground truth)."""

import logging
from io import BytesIO

logger = logging.getLogger(__name__)


def extract_pdf_page_texts(pdf_bytes: bytes, *, max_pages: int) -> dict[int, str]:
    try:
        from pypdf import PdfReader
    except ImportError:
        logger.warning("pypdf not installed; PDF text hints disabled.")
        return {}

    out: dict[int, str] = {}
    try:
        reader = PdfReader(BytesIO(pdf_bytes))
        n = min(len(reader.pages), max_pages)
        for i in range(n):
            try:
                t = reader.pages[i].extract_text() or ""
            except Exception:
                t = ""
            t = t.strip()
            if t:
                out[i] = t[:12000]
    except Exception as e:
        logger.warning("PDF text extraction failed: %s", e)
    return out
