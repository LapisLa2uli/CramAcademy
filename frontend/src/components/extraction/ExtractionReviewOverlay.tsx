"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ExtractionNormRect, ExtractionRegion, ExtractionRegionRole } from "@/types";

const ROLE_STYLES: Record<
  ExtractionRegionRole,
  { border: string; bg: string; text: string }
> = {
  context: { border: "#0891b2", bg: "rgba(8,145,178,0.12)", text: "#0e7490" },
  shared_stem: { border: "#7c3aed", bg: "rgba(124,58,237,0.12)", text: "#5b21b6" },
  question_stem: { border: "#4f46e5", bg: "rgba(79,70,229,0.12)", text: "#3730a3" },
  choice: { border: "#d97706", bg: "rgba(217,119,6,0.12)", text: "#92400e" },
  answer_key: { border: "#059669", bg: "rgba(5,150,105,0.15)", text: "#065f46" },
  explanation: { border: "#2563eb", bg: "rgba(37,99,235,0.12)", text: "#1e3a8a" },
  frq_prompt: { border: "#db2777", bg: "rgba(219,39,119,0.1)", text: "#9d174d" },
  other: { border: "#6b7280", bg: "rgba(107,114,128,0.1)", text: "#374151" },
};

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

function clampRect(b: ExtractionNormRect): ExtractionNormRect {
  const x = clamp01(b.x);
  const y = clamp01(b.y);
  const w = Math.max(0.002, Math.min(1 - x, b.w));
  const h = Math.max(0.002, Math.min(1 - y, b.h));
  return { x, y, w, h };
}

type DragMode = "none" | "move" | "nw" | "ne" | "sw" | "se";

function applyResize(
  orig: ExtractionNormRect,
  mode: Exclude<DragMode, "none" | "move">,
  nx: number,
  ny: number
): ExtractionNormRect {
  let { x, y, w, h } = orig;
  const right = x + w;
  const bottom = y + h;
  if (mode === "se") {
    w = clamp01(nx) - x;
    h = clamp01(ny) - y;
  } else if (mode === "sw") {
    const nx2 = clamp01(nx);
    w = right - nx2;
    x = nx2;
    h = clamp01(ny) - y;
  } else if (mode === "ne") {
    w = clamp01(nx) - x;
    const ny2 = clamp01(ny);
    h = bottom - ny2;
    y = ny2;
  } else if (mode === "nw") {
    const nx2 = clamp01(nx);
    const ny2 = clamp01(ny);
    w = right - nx2;
    h = bottom - ny2;
    x = nx2;
    y = ny2;
  }
  return clampRect({ x, y, w, h });
}

interface ExtractionReviewOverlayProps {
  imageBase64: string;
  regions: ExtractionRegion[];
  bboxOverrides: Record<string, ExtractionNormRect>;
  onRegionBboxChange: (regionId: string, next: ExtractionNormRect) => void;
  className?: string;
}

export default function ExtractionReviewOverlay({
  imageBase64,
  regions,
  bboxOverrides,
  onRegionBboxChange,
  className = "",
}: ExtractionReviewOverlayProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onRegionBboxChange);
  onChangeRef.current = onRegionBboxChange;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const dragRef = useRef<{
    mode: Exclude<DragMode, "none">;
    id: string;
    startX: number;
    startY: number;
    orig: ExtractionNormRect;
  } | null>(null);

  const src = useMemo(() => {
    const raw = imageBase64.trim();
    return raw.startsWith("data:") ? raw : `data:image/png;base64,${raw}`;
  }, [imageBase64]);

  const displayBbox = useCallback(
    (r: ExtractionRegion) => bboxOverrides[r.id] ?? r.bbox,
    [bboxOverrides]
  );

  const toNorm = useCallback((clientX: number, clientY: number) => {
    const el = wrapRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
    return {
      x: (clientX - rect.left) / rect.width,
      y: (clientY - rect.top) / rect.height,
    };
  }, []);

  const hitTest = useCallback(
    (nx: number, ny: number, b: ExtractionNormRect, threshold: number) => {
      const left = b.x;
      const right = b.x + b.w;
      const top = b.y;
      const bottom = b.y + b.h;
      if (nx < left || nx > right || ny < top || ny > bottom) return null;
      const t = threshold;
      if (nx <= left + t && ny <= top + t) return "nw" as const;
      if (nx >= right - t && ny <= top + t) return "ne" as const;
      if (nx <= left + t && ny >= bottom - t) return "sw" as const;
      if (nx >= right - t && ny >= bottom - t) return "se" as const;
      return "move" as const;
    },
    []
  );

  const beginDrag = useCallback(
    (
      id: string,
      mode: Exclude<DragMode, "none">,
      orig: ExtractionNormRect,
      startNX: number,
      startNY: number
    ) => {
      dragRef.current = { mode, id, startX: startNX, startY: startNY, orig: { ...orig } };
      const onMove = (e: MouseEvent) => {
        const d = dragRef.current;
        const el = wrapRef.current;
        if (!d || !el) return;
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        const nx = (e.clientX - rect.left) / rect.width;
        const ny = (e.clientY - rect.top) / rect.height;
        const o = d.orig;
        let next: ExtractionNormRect;
        if (d.mode === "move") {
          const dx = nx - d.startX;
          const dy = ny - d.startY;
          next = clampRect({
            x: o.x + dx,
            y: o.y + dy,
            w: o.w,
            h: o.h,
          });
        } else {
          next = applyResize(o, d.mode, nx, ny);
        }
        onChangeRef.current(d.id, next);
      };
      const onUp = () => {
        dragRef.current = null;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    []
  );

  useEffect(() => {
    return () => {
      dragRef.current = null;
    };
  }, []);

  const onBoxMouseDown = (e: React.MouseEvent, r: ExtractionRegion) => {
    e.preventDefault();
    e.stopPropagation();
    const b = displayBbox(r);
    const { x: nx, y: ny } = toNorm(e.clientX, e.clientY);
    const th = Math.max(0.02, Math.min(b.w, b.h) * 0.15);
    const corner = hitTest(nx, ny, b, th);
    if (!corner) {
      setSelectedId(r.id);
      return;
    }
    setSelectedId(r.id);
    beginDrag(r.id, corner, b, nx, ny);
  };

  const onCornerMouseDown = (
    e: React.MouseEvent,
    r: ExtractionRegion,
    mode: "nw" | "ne" | "sw" | "se"
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const b = displayBbox(r);
    const { x: nx, y: ny } = toNorm(e.clientX, e.clientY);
    setSelectedId(r.id);
    beginDrag(r.id, mode, b, nx, ny);
  };

  return (
    <div className={`space-y-2 ${className}`}>
      <div ref={wrapRef} className="relative inline-block max-w-full select-none">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt="Page"
          className="block max-h-[70vh] w-auto rounded border border-gray-200"
          draggable={false}
        />
        <div className="absolute inset-0">
          {regions.map((r) => {
            const b = displayBbox(r);
            const st = ROLE_STYLES[r.role] ?? ROLE_STYLES.other;
            const sel = selectedId === r.id;
            return (
              <div
                key={r.id}
                role="button"
                tabIndex={0}
                className={`absolute rounded cursor-grab active:cursor-grabbing ${
                  sel ? "ring-2 ring-offset-1 ring-amber-400 z-10" : "z-[1]"
                } border`}
                style={{
                  left: `${b.x * 100}%`,
                  top: `${b.y * 100}%`,
                  width: `${b.w * 100}%`,
                  height: `${b.h * 100}%`,
                  borderColor: st.border,
                  backgroundColor: st.bg,
                }}
                onMouseDown={(e) => onBoxMouseDown(e, r)}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedId(r.id);
                }}
              >
                <span
                  className="absolute -top-5 left-0 text-[10px] font-medium px-1 py-0.5 rounded shadow-sm whitespace-nowrap max-w-[240px] truncate bg-white/95 pointer-events-none"
                  style={{ color: st.text }}
                  title={r.label}
                >
                  S{r.set_index} · {r.label}
                </span>
                {sel && (
                  <>
                    {(
                      [
                        ["nw", "nwse-resize"],
                        ["ne", "nesw-resize"],
                        ["sw", "nesw-resize"],
                        ["se", "nwse-resize"],
                      ] as const
                    ).map(([c, cur]) => (
                      <span
                        key={c}
                        role="presentation"
                        className="absolute z-20 w-2.5 h-2.5 bg-white border border-amber-500 rounded-sm pointer-events-auto"
                        style={{
                          cursor: cur,
                          ...(c.includes("n") ? { top: -5 } : { bottom: -5 }),
                          ...(c.includes("w") ? { left: -5 } : { right: -5 }),
                        }}
                        onMouseDown={(e) => onCornerMouseDown(e, r, c)}
                      />
                    ))}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <p className="text-xs text-gray-500">
        Click a box to select. Drag inside to move; drag corners to resize. Crops used at commit refresh
        after you pause (preview below).
      </p>
    </div>
  );
}
