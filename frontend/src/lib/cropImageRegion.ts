import { clampNormRect, type NormRect } from "./pdf/cropPdfPage";
export type { NormRect };
export { clampNormRect };

/**
 * Crop a normalized region from an HTML image and return it as a PNG Blob.
 */
export function cropImageRegionToPng(
  img: HTMLImageElement,
  norm: NormRect
): Promise<Blob> {
  const c = clampNormRect(norm);
  const sx = Math.floor(c.x * img.naturalWidth);
  const sy = Math.floor(c.y * img.naturalHeight);
  const sw = Math.ceil(c.w * img.naturalWidth);
  const sh = Math.ceil(c.h * img.naturalHeight);
  if (sw < 4 || sh < 4) {
    throw new Error("Selected region is too small. Drag a larger box.");
  }

  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("PNG export failed"))),
      "image/png"
    );
  });
}
