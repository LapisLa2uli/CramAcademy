/**
 * Client-side PDF/image → PNG bytes + dimensions (mirrors backend render/resize behavior).
 */

function isPdfFile(f: File): boolean {
  return f.type === "application/pdf" || /\.pdf$/i.test(f.name);
}

function resizeCanvasToMaxEdge(
  source: HTMLCanvasElement,
  maxEdge: number
): { canvas: HTMLCanvasElement; w: number; h: number } {
  const w0 = source.width;
  const h0 = source.height;
  const longest = Math.max(w0, h0);
  if (longest <= maxEdge) {
    return { canvas: source, w: w0, h: h0 };
  }
  const scale = maxEdge / longest;
  const nw = Math.max(1, Math.round(w0 * scale));
  const nh = Math.max(1, Math.round(h0 * scale));
  const canvas = document.createElement("canvas");
  canvas.width = nw;
  canvas.height = nh;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { canvas: source, w: w0, h: h0 };
  ctx.drawImage(source, 0, 0, nw, nh);
  return { canvas, w: nw, h: nh };
}

async function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/png")
  );
  if (!blob) throw new Error("Failed to encode PNG.");
  return new Uint8Array(await blob.arrayBuffer());
}

async function imageFileToPngBytes(file: File): Promise<{ png: Uint8Array; w: number; h: number }> {
  const bmp = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unsupported.");
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const png = await canvasToPngBytes(canvas);
  return { png, w: canvas.width, h: canvas.height };
}

export type PreparedPage = {
  pageIndex: number;
  pngBytes: Uint8Array;
  width: number;
  height: number;
};

export async function preparePagesFromFiles(
  files: File[],
  options: {
    maxPages: number;
    dpi: number;
    maxEdge: number;
  }
): Promise<PreparedPage[]> {
  const { maxPages, dpi, maxEdge } = options;
  const limit = Math.min(maxPages, 24);

  if (files.length === 0) return [];

  if (files.length === 1 && isPdfFile(files[0])) {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
    const buf = await files[0].arrayBuffer();
    const doc = await pdfjs.getDocument({ data: buf }).promise;
    const n = Math.min(doc.numPages, limit);
    const scale = dpi / 72;
    const out: PreparedPage[] = [];
    for (let i = 1; i <= n; i++) {
      const page = await doc.getPage(i);
      const vp = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(vp.width);
      canvas.height = Math.ceil(vp.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas unsupported.");
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      const { canvas: resized, w, h } = resizeCanvasToMaxEdge(canvas, maxEdge);
      const pngBytes = await canvasToPngBytes(resized);
      out.push({ pageIndex: i - 1, pngBytes, width: w, height: h });
    }
    return out;
  }

  const out2: PreparedPage[] = [];
  for (let i = 0; i < Math.min(files.length, limit); i++) {
    const f = files[i];
    const { png: rawPng, w: w0, h: h0 } = await imageFileToPngBytes(f);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unsupported.");
    const bmp = await createImageBitmap(
      new Blob([new Uint8Array(rawPng)], { type: "image/png" })
    );
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    const { canvas: resized, w, h } = resizeCanvasToMaxEdge(canvas, maxEdge);
    const pngBytes = await canvasToPngBytes(resized);
    out2.push({ pageIndex: i, pngBytes, width: w, height: h });
  }
  return out2;
}
