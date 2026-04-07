import type { ExtractionNormRect } from "@/types";

/** Load page image from extraction payload (PNG/JPEG data URL or raw base64). */
function loadImageFromExtractionBase64(imageBase64: string): Promise<HTMLImageElement> {
  const raw = imageBase64.trim();
  const url = raw.startsWith("data:") ? raw : `data:image/png;base64,${raw}`;
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load page image for crop."));
    img.src = url;
  });
}

/**
 * Crop normalized bbox from extraction page bitmap; returns PNG blob.
 */
export async function cropNormRectToPngBlob(
  imageBase64: string,
  bbox: ExtractionNormRect,
  widthPx: number,
  heightPx: number
): Promise<Blob> {
  const img = await loadImageFromExtractionBase64(imageBase64);
  const sx = Math.max(0, Math.floor(bbox.x * widthPx));
  const sy = Math.max(0, Math.floor(bbox.y * heightPx));
  const sw = Math.max(1, Math.ceil(bbox.w * widthPx));
  const sh = Math.max(1, Math.ceil(bbox.h * heightPx));
  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Crop failed"))), "image/png");
  });
}
