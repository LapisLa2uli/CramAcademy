import io

import pypdfium2 as pdfium
from PIL import Image


def pdf_bytes_to_png_pages(data: bytes, *, max_pages: int, dpi: int) -> list[bytes]:
    """Render PDF pages to PNG bytes (RGB)."""
    doc = pdfium.PdfDocument(data)
    n = min(len(doc), max_pages)
    scale = dpi / 72.0
    out: list[bytes] = []
    for i in range(n):
        page = doc[i]
        pil_image = page.render(scale=scale).to_pil()
        if pil_image.mode not in ("RGB", "L"):
            pil_image = pil_image.convert("RGB")
        buf = io.BytesIO()
        pil_image.save(buf, format="PNG", optimize=True)
        out.append(buf.getvalue())
        page.close()
    doc.close()
    return out


def pdf_bytes_to_single_png_page(data: bytes, *, page_index: int, dpi: int) -> bytes:
    """Render a single PDF page (0-based index) to PNG bytes."""
    doc = pdfium.PdfDocument(data)
    try:
        if page_index < 0 or page_index >= len(doc):
            raise ValueError(f"page_index {page_index} out of range (doc has {len(doc)} pages)")
        scale = dpi / 72.0
        page = doc[page_index]
        try:
            pil_image = page.render(scale=scale).to_pil()
            if pil_image.mode not in ("RGB", "L"):
                pil_image = pil_image.convert("RGB")
            buf = io.BytesIO()
            pil_image.save(buf, format="PNG", optimize=True)
            return buf.getvalue()
        finally:
            page.close()
    finally:
        doc.close()


def image_file_to_png_bytes(raw: bytes) -> bytes:
    """Normalize an uploaded image to PNG bytes."""
    im = Image.open(io.BytesIO(raw))
    if im.mode not in ("RGB", "RGBA", "L"):
        im = im.convert("RGB")
    elif im.mode == "RGBA":
        bg = Image.new("RGB", im.size, (255, 255, 255))
        bg.paste(im, mask=im.split()[3])
        im = bg
    buf = io.BytesIO()
    im.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def resize_png_max_edge(png_bytes: bytes, max_edge: int) -> tuple[bytes, int, int]:
    """Downscale if longest edge > max_edge; returns png bytes and final width, height."""
    im = Image.open(io.BytesIO(png_bytes))
    w, h = im.size
    longest = max(w, h)
    if longest <= max_edge:
        if im.mode not in ("RGB", "L"):
            im = im.convert("RGB")
        buf = io.BytesIO()
        im.save(buf, format="PNG", optimize=True)
        return buf.getvalue(), w, h
    scale = max_edge / longest
    nw = max(1, int(w * scale))
    nh = max(1, int(h * scale))
    im = im.resize((nw, nh), Image.Resampling.LANCZOS)
    if im.mode not in ("RGB", "L"):
        im = im.convert("RGB")
    buf = io.BytesIO()
    im.save(buf, format="PNG", optimize=True)
    return buf.getvalue(), nw, nh


def prepare_extraction_stream_image(
    png_bytes: bytes,
    *,
    max_edge: int,
    use_jpeg: bool,
    jpeg_quality: int,
) -> tuple[bytes, str, int, int]:
    """
    Resize (if needed) and encode for the extraction NDJSON stream.
    Returns (encoded_bytes, mime_type, width, height).
    """
    im = Image.open(io.BytesIO(png_bytes))
    w, h = im.size
    longest = max(w, h)
    if max_edge > 0 and longest > max_edge:
        scale = max_edge / longest
        nw = max(1, int(w * scale))
        nh = max(1, int(h * scale))
        im = im.resize((nw, nh), Image.Resampling.LANCZOS)
        w, h = nw, nh
    if im.mode not in ("RGB", "L"):
        im = im.convert("RGB")
    buf = io.BytesIO()
    if use_jpeg:
        im.save(buf, format="JPEG", quality=jpeg_quality, optimize=True)
        return buf.getvalue(), "image/jpeg", w, h
    im.save(buf, format="PNG", optimize=True)
    return buf.getvalue(), "image/png", w, h
