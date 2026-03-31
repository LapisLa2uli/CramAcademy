import type { PDFDocumentProxy } from "pdfjs-dist";

export type NormRect = { x: number; y: number; w: number; h: number };

/** 0–1 coordinates relative to rendered page (top-left origin). */
export function clampNormRect(r: NormRect): NormRect {
  const x = Math.min(Math.max(r.x, 0), 1);
  const y = Math.min(Math.max(r.y, 0), 1);
  const w = Math.min(Math.max(r.w, 0.001), 1 - x);
  const h = Math.min(Math.max(r.h, 0.001), 1 - y);
  return { x, y, w, h };
}

/**
 * Render one PDF page at `scale` and return a PNG blob of the normalized region.
 */
export async function cropPdfRegionToPng(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  scale: number,
  norm: NormRect
): Promise<Blob> {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");

  const renderTask = page.render({
    canvasContext: ctx,
    viewport,
  });
  await renderTask.promise;

  const c = clampNormRect(norm);
  const sx = Math.floor(c.x * canvas.width);
  const sy = Math.floor(c.y * canvas.height);
  const sw = Math.ceil(c.w * canvas.width);
  const sh = Math.ceil(c.h * canvas.height);
  if (sw < 4 || sh < 4) {
    throw new Error("Selected region is too small. Drag a larger box.");
  }

  const out = document.createElement("canvas");
  out.width = sw;
  out.height = sh;
  const octx = out.getContext("2d");
  if (!octx) throw new Error("Canvas not supported");
  octx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);

  return new Promise((resolve, reject) => {
    out.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG export failed"))), "image/png");
  });
}
