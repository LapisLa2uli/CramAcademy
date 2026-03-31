"use client";

import type { ContributionDay } from "@/types";

function cellClass(points: number) {
  if (points <= 0) return "bg-gray-100";
  if (points < 3) return "bg-emerald-200";
  if (points < 8) return "bg-emerald-400";
  return "bg-emerald-600";
}

/** Pad chronological days so the grid aligns with Sunday-first columns (UTC, matching API dates). */
function padWeekGrid(days: ContributionDay[]): (ContributionDay | null)[] {
  if (days.length === 0) return [];
  const first = days[0].date;
  const d = new Date(first + "T12:00:00Z");
  const padBefore = d.getUTCDay();
  const total = days.length + padBefore;
  const padAfter = (7 - (total % 7)) % 7;
  return [...Array(padBefore).fill(null), ...days, ...Array(padAfter).fill(null)];
}

export default function ContributionHeatmap({ days }: { days: ContributionDay[] }) {
  const cells = padWeekGrid(days);
  const weekCount = Math.ceil(cells.length / 7);

  return (
    <div className="overflow-x-auto pb-2">
      <div
        className="inline-grid gap-1 min-h-[84px]"
        style={{
          gridTemplateRows: "repeat(7, 11px)",
          gridAutoFlow: "column",
          gridAutoColumns: "11px",
        }}
        role="img"
        aria-label="Contribution activity over the last year"
      >
        {cells.map((d, i) =>
          d ? (
            <div
              key={d.date}
              title={`${d.date}: ${d.points} pts (${d.count} approved)`}
              className={`rounded-sm ${cellClass(d.points)}`}
            />
          ) : (
            <div key={`pad-${i}`} className="rounded-sm opacity-0 pointer-events-none" aria-hidden />
          )
        )}
      </div>
      <p className="text-xs text-gray-500 mt-2">
        {weekCount} weeks · greener = more contribution points that day (MCQ +1, FRQ +5 on approval)
      </p>
    </div>
  );
}
