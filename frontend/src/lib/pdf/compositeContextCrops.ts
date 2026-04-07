/**
 * Stack PNG blobs vertically without scaling each strip (only horizontal padding
 * so all rows share one canvas width = max strip width).
 */
export async function compositePngBlobsVertical(blobs: Blob[]): Promise<Blob> {
  if (blobs.length === 0) {
    throw new Error("No context crops to composite.");
  }
  const bitmaps = await Promise.all(
    blobs.map(
      (b) =>
        new Promise<HTMLImageElement>((resolve, reject) => {
          const url = URL.createObjectURL(b);
          const img = new Image();
          img.onload = () => {
            URL.revokeObjectURL(url);
            resolve(img);
          };
          img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error("Failed to decode context crop."));
          };
          img.src = url;
        })
    )
  );

  const maxW = Math.max(...bitmaps.map((im) => im.naturalWidth || im.width), 1);
  const totalH = bitmaps.reduce((s, im) => s + (im.naturalHeight || im.height), 0);
  const canvas = document.createElement("canvas");
  canvas.width = maxW;
  canvas.height = Math.max(totalH, 1);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  let y = 0;
  for (const im of bitmaps) {
    const w = im.naturalWidth || im.width;
    const h = im.naturalHeight || im.height;
    const x = Math.floor((maxW - w) / 2);
    ctx.drawImage(im, x, y, w, h);
    y += h;
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG composite failed"))), "image/png");
  });
}
