"""Extract embedded text from PDF bytes per page (hint for vision; image stays ground truth)."""

import logging
from io import BytesIO

logger = logging.getLogger(__name__)


def extract_pdf_page_texts(pdf_bytes: bytes, *, max_pages: int) -> dict[int, str]:
    # Primary path: pypdf text layer.
    try:
        from pypdf import PdfReader
    except ImportError:
        reader = None
    out: dict[int, str] = {}
    if reader is not None:
        try:
            doc = PdfReader(BytesIO(pdf_bytes))
            n = min(len(doc.pages), max_pages)
            for i in range(n):
                try:
                    t = doc.pages[i].extract_text() or ""
                except Exception:
                    t = ""
                t = t.strip()
                if t:
                    out[i] = t[:12000]
        except Exception as e:
            logger.warning("pypdf text extraction failed: %s", e)
    if out:
        return out

    # Fallback path: pypdfium2 textpage extraction.
    try:
        import pypdfium2 as pdfium
    except Exception:
        logger.warning("pypdf unavailable and pypdfium2 text fallback unavailable.")
        return {}

    try:
        pdf = pdfium.PdfDocument(pdf_bytes)
        n = min(len(pdf), max_pages)
        for i in range(n):
            try:
                page = pdf[i]
                tp = page.get_textpage()
                t = (tp.get_text_range() or "").strip()
                tp.close()
                page.close()
            except Exception:
                t = ""
            if t:
                out[i] = t[:12000]
        pdf.close()
    except Exception as e:
        logger.warning("pypdfium2 text fallback failed: %s", e)
    return out
