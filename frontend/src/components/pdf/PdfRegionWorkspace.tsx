"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import type { NormRect } from "@/lib/pdf/cropPdfPage";
import { clampNormRect } from "@/lib/pdf/cropPdfPage";

export type RegionMode = "stem" | "A" | "B" | "C" | "D" | "context";

const MODE_LABELS: Record<RegionMode, string> = {
  stem: "Question",
  A: "Choice A",
  B: "Choice B",
  C: "Choice C",
  D: "Choice D",
  context: "Context / Passage",
};

const REGION_COLORS: Record<RegionMode, { border: string; bg: string }> = {
  stem: { border: "#7c3aed", bg: "rgba(124,58,237,0.15)" },
  A: { border: "#dc2626", bg: "rgba(220,38,38,0.15)" },
  B: { border: "#2563eb", bg: "rgba(37,99,235,0.15)" },
  C: { border: "#059669", bg: "rgba(5,150,105,0.15)" },
  D: { border: "#d97706", bg: "rgba(217,119,6,0.15)" },
  context: { border: "#0891b2", bg: "rgba(8,145,178,0.15)" },
};

export type ExtraRegionOverlay = {
  id: string;
  rect: NormRect;
  label: string;
};

interface PdfRegionWorkspaceProps {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  rects: Partial<Record<RegionMode, NormRect>>;
  activeMode: RegionMode | null;
  onRectSet: (mode: RegionMode, rect: NormRect) => void;
  onClear: (mode: RegionMode) => void;
  /** Read-only boxes (e.g. ordered context fragments on this page). */
  extraRegions?: ExtraRegionOverlay[];
}

export default function PdfRegionWorkspace({
  pdf,
  pageNumber,
  scale,
  rects,
  activeMode,
  onRectSet,
  onClear,
  extraRegions,
}: PdfRegionWorkspaceProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const [ready, setReady] = useState(false);
  const [drag, setDrag] = useState<{
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;

    const cancelRender = () => {
      try {
        renderTaskRef.current?.cancel();
      } catch {
        /* ignore */
      }
      renderTaskRef.current = null;
    };

    cancelRender();
    setReady(false);

    const canvas = canvasRef.current;
    if (!canvas) return () => cancelRender();

    void (async () => {
      try {
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;

        const viewport = page.getViewport({ scale });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d");
        if (!ctx || cancelled) return;

        const task = page.render({
          canvasContext: ctx,
          viewport,
        });
        renderTaskRef.current = task;

        try {
          await task.promise;
        } catch (err) {
          renderTaskRef.current = null;
          if (cancelled) return;
          const name = err instanceof Error ? err.name : "";
          const msg = err instanceof Error ? err.message : String(err);
          if (
            name === "RenderingCancelledException" ||
            msg.includes("Rendering cancelled") ||
            msg.includes("same canvas")
          ) {
            return;
          }
          throw err;
        }

        renderTaskRef.current = null;
        if (!cancelled) setReady(true);
      } catch {
        renderTaskRef.current = null;
        if (!cancelled) setReady(false);
      }
    })();

    return () => {
      cancelled = true;
      cancelRender();
    };
  }, [pdf, pageNumber, scale]);

  const toNorm = useCallback((clientX: number, clientY: number) => {
    const el = wrapRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return {
      x: (clientX - r.left) / r.width,
      y: (clientY - r.top) / r.height,
    };
  }, []);

  const onMouseDown = (e: React.MouseEvent) => {
    if (!activeMode || !ready) return;
    e.preventDefault();
    const p = toNorm(e.clientX, e.clientY);
    setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!drag) return;
    const p = toNorm(e.clientX, e.clientY);
    setDrag((d) => (d ? { ...d, x1: p.x, y1: p.y } : null));
  };

  const finishDrag = () => {
    if (!drag || !activeMode) {
      setDrag(null);
      return;
    }
    const x = Math.min(drag.x0, drag.x1);
    const y = Math.min(drag.y0, drag.y1);
    const w = Math.abs(drag.x1 - drag.x0);
    const h = Math.abs(drag.y1 - drag.y0);
    setDrag(null);
    if (w < 0.012 || h < 0.012) return;
    onRectSet(activeMode, clampNormRect({ x, y, w, h }));
  };

  const dragPreview = drag
    ? (() => {
        const x = Math.min(drag.x0, drag.x1);
        const y = Math.min(drag.y0, drag.y1);
        const w = Math.abs(drag.x1 - drag.x0);
        const h = Math.abs(drag.y1 - drag.y0);
        return {
          left: `${x * 100}%`,
          top: `${y * 100}%`,
          width: `${w * 100}%`,
          height: `${h * 100}%`,
        };
      })()
    : null;

  return (
    <div className="space-y-3">
      <div
        ref={wrapRef}
        className="relative inline-block max-w-full border border-gray-300 rounded-lg overflow-hidden bg-white shadow-sm"
      >
        <canvas ref={canvasRef} className="block max-w-full h-auto" />
        {(Object.entries(rects) as [RegionMode, NormRect | undefined][]).map(
          ([key, rect]) =>
            rect ? (
              <div
                key={key}
                className="absolute border-2 pointer-events-none"
                style={{
                  left: `${rect.x * 100}%`,
                  top: `${rect.y * 100}%`,
                  width: `${rect.w * 100}%`,
                  height: `${rect.h * 100}%`,
                  borderColor: REGION_COLORS[key]?.border ?? "#059669",
                  backgroundColor: REGION_COLORS[key]?.bg ?? "rgba(16,185,129,0.15)",
                }}
              />
            ) : null
        )}
        {(extraRegions ?? []).map((er) => (
          <div
            key={er.id}
            className="absolute border border-cyan-600 pointer-events-none z-[5]"
            style={{
              left: `${er.rect.x * 100}%`,
              top: `${er.rect.y * 100}%`,
              width: `${er.rect.w * 100}%`,
              height: `${er.rect.h * 100}%`,
              borderColor: REGION_COLORS.context.border,
              backgroundColor: REGION_COLORS.context.bg,
            }}
          >
            <span className="absolute -top-4 left-0 text-[9px] font-medium px-1 py-0.5 rounded bg-white/95 text-cyan-800 shadow-sm whitespace-nowrap">
              {er.label}
            </span>
          </div>
        ))}
        {dragPreview && activeMode && (
          <div
            className="absolute border-2 border-dashed border-amber-500 bg-amber-400/15 pointer-events-none z-10"
            style={dragPreview}
          />
        )}
        <div
          className={`absolute inset-0 z-20 ${
            activeMode && ready ? "cursor-crosshair" : "cursor-default"
          }`}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={finishDrag}
          onMouseLeave={() => {
            if (drag) {
              setDrag(null);
            }
          }}
        />
      </div>
      {!ready && <p className="text-sm text-gray-500">Rendering page…</p>}
      <div className="flex flex-wrap gap-2">
        {(Object.keys(MODE_LABELS) as RegionMode[]).map((m) =>
          rects[m] ? (
            <button
              type="button"
              key={m}
              onClick={() => onClear(m)}
              className="btn-secondary text-xs py-1 px-2"
            >
              Clear {MODE_LABELS[m]}
            </button>
          ) : null
        )}
      </div>
    </div>
  );
}

export { MODE_LABELS, REGION_COLORS };
