"use client";

import { useRef, useState, useCallback } from "react";
import { type NormRect, clampNormRect } from "@/lib/cropImageRegion";
import { type RegionMode, MODE_LABELS, REGION_COLORS } from "./PdfRegionWorkspace";

interface ImageRegionWorkspaceProps {
  src: string;
  rects: Partial<Record<RegionMode, NormRect>>;
  activeMode: RegionMode | null;
  onRectSet: (mode: RegionMode, rect: NormRect) => void;
  onClear: (mode: RegionMode) => void;
  onImgRef?: (el: HTMLImageElement | null) => void;
}

export default function ImageRegionWorkspace({
  src,
  rects,
  activeMode,
  onRectSet,
  onClear,
  onImgRef,
}: ImageRegionWorkspaceProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  } | null>(null);

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
    if (!activeMode) return;
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
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={(el) => onImgRef?.(el)}
          src={src}
          alt="Page"
          className="block max-w-full h-auto"
          draggable={false}
        />

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

        {dragPreview && activeMode && (
          <div
            className="absolute border-2 border-dashed border-amber-500 bg-amber-400/15 pointer-events-none z-10"
            style={dragPreview}
          />
        )}

        <div
          className={`absolute inset-0 z-20 ${
            activeMode ? "cursor-crosshair" : "cursor-default"
          }`}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={finishDrag}
          onMouseLeave={() => drag && setDrag(null)}
        />
      </div>

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
