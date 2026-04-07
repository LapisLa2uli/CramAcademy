"use client";

import type { ExtractionRegion, ExtractionRegionRole } from "@/types";

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

function boxStyle(
  b: { x: number; y: number; w: number; h: number },
  color: { border: string; bg: string }
) {
  return {
    left: `${b.x * 100}%`,
    top: `${b.y * 100}%`,
    width: `${b.w * 100}%`,
    height: `${b.h * 100}%`,
    borderColor: color.border,
    backgroundColor: color.bg,
  } as const;
}

interface ExtractionOverlayCanvasProps {
  imageBase64: string;
  regions: ExtractionRegion[];
  className?: string;
}

export default function ExtractionOverlayCanvas({
  imageBase64,
  regions,
  className = "",
}: ExtractionOverlayCanvasProps) {
  const src = `data:image/png;base64,${imageBase64}`;

  return (
    <div className={`relative inline-block max-w-full ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="Page" className="block max-h-[70vh] w-auto rounded border border-gray-200" />
      <div className="absolute inset-0 pointer-events-none">
        {regions.map((r) => {
          const st = ROLE_STYLES[r.role] ?? ROLE_STYLES.other;
          return (
            <div
              key={r.id}
              className="absolute rounded border"
              style={boxStyle(r.bbox, st)}
            >
              <span
                className="absolute -top-5 left-0 text-[10px] font-medium px-1 py-0.5 rounded shadow-sm whitespace-nowrap max-w-[240px] truncate bg-white/95"
                style={{ color: st.text }}
                title={r.label}
              >
                S{r.set_index} · {r.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
