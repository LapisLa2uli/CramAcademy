"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { NormRect } from "@/lib/pdf/cropPdfPage";
import type { RegionMode } from "./PdfRegionWorkspace";
import { REGION_COLORS } from "./PdfRegionWorkspace";

const THUMB_SCALE = 0.2;

interface PageThumbnailStripProps {
  pdf: PDFDocumentProxy | null;
  imagePages: string[];
  numPages: number;
  currentPage: number;
  onSelectPage: (page: number) => void;
  /** Page-keyed rects: pageNum -> regions */
  pageRects: Record<number, Partial<Record<RegionMode, NormRect>>>;
  /** Optional: number of context passage boxes drawn on each page (multi-box context). */
  contextBoxCountByPage?: Record<number, number>;
}

export default function PageThumbnailStrip({
  pdf,
  imagePages,
  numPages,
  currentPage,
  onSelectPage,
  pageRects,
  contextBoxCountByPage,
}: PageThumbnailStripProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  if (numPages === 0) return null;

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-gray-700">Pages</label>
      <div
        ref={scrollRef}
        className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin"
      >
        {Array.from({ length: numPages }, (_, i) => i + 1).map((pageNum) => {
          const active = pageNum === currentPage;
          const rects = pageRects[pageNum];
          const regionModes = rects ? (Object.keys(rects) as RegionMode[]) : [];
          const ctxCount = contextBoxCountByPage?.[pageNum] ?? 0;

          return (
            <button
              key={pageNum}
              type="button"
              onClick={() => onSelectPage(pageNum)}
              className={`relative flex-shrink-0 rounded-lg border-2 overflow-hidden transition-all ${
                active
                  ? "border-primary-500 ring-2 ring-primary-300"
                  : "border-gray-200 hover:border-gray-400"
              }`}
              style={{ width: 100, minHeight: 70 }}
            >
              {pdf ? (
                <PdfThumb pdf={pdf} pageNumber={pageNum} />
              ) : imagePages[pageNum - 1] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={imagePages[pageNum - 1]}
                  alt={`Page ${pageNum}`}
                  className="w-full h-auto object-contain bg-white"
                  draggable={false}
                />
              ) : null}

              {/* Page number badge */}
              <span className="absolute bottom-0.5 right-0.5 text-[10px] bg-black/60 text-white px-1 rounded">
                {pageNum}
              </span>

              {/* Region indicator dots */}
              {(regionModes.length > 0 || ctxCount > 0) && (
                <div className="absolute top-0.5 left-0.5 flex flex-wrap gap-0.5 max-w-[90%]">
                  {ctxCount > 0 &&
                    Array.from({ length: Math.min(ctxCount, 6) }, (_, i) => (
                      <span
                        key={`ctx-${i}`}
                        className="w-2.5 h-2.5 rounded-full border border-white"
                        style={{ backgroundColor: REGION_COLORS.context.border }}
                        title={`${ctxCount} context box(es) on this page`}
                      />
                    ))}
                  {regionModes.map((mode) => (
                    <span
                      key={mode}
                      className="w-2.5 h-2.5 rounded-full border border-white"
                      style={{ backgroundColor: REGION_COLORS[mode]?.border ?? "#666" }}
                      title={mode}
                    />
                  ))}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Renders a small PDF page thumbnail on a canvas. */
function PdfThumb({
  pdf,
  pageNumber,
}: {
  pdf: PDFDocumentProxy;
  pageNumber: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  const render = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: THUMB_SCALE });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      await page.render({ canvasContext: ctx, viewport }).promise;
      setReady(true);
    } catch {
      /* ignore render errors for thumbnails */
    }
  }, [pdf, pageNumber]);

  useEffect(() => {
    void render();
  }, [render]);

  return (
    <canvas
      ref={canvasRef}
      className={`w-full h-auto bg-white ${ready ? "" : "opacity-30"}`}
    />
  );
}
