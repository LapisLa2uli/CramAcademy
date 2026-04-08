/** Optional embedded PDF text per page (mirrors backend pdf_text_hint). */

export async function extractPdfPageTexts(
  file: File,
  maxPages: number
): Promise<Record<number, string>> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const n = Math.min(doc.numPages, maxPages);
  const out: Record<number, string> = {};
  for (let i = 1; i <= n; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    const chunks = tc.items.map((it) => ("str" in it ? (it as { str: string }).str : "")).join(" ");
    out[i - 1] = chunks.replace(/\s+/g, " ").trim();
  }
  return out;
}
