"use client";

import { cn } from "@/lib/utils";

interface NavigationPanelProps {
  total: number;
  current: number;
  answered: Set<number>;
  flagged: Set<number>;
  onNavigate: (index: number) => void;
}

export default function NavigationPanel({
  total,
  current,
  answered,
  flagged,
  onNavigate,
}: NavigationPanelProps) {
  return (
    <div className="w-64 bg-white border-r border-gray-200 p-4 flex flex-col">
      <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">
        Questions
      </h3>
      <div className="grid grid-cols-5 gap-2">
        {Array.from({ length: total }, (_, i) => (
          <button
            key={i}
            onClick={() => onNavigate(i)}
            className={cn(
              "w-10 h-10 rounded-lg text-sm font-medium transition-all duration-150",
              i === current && "ring-2 ring-primary-500 ring-offset-1",
              answered.has(i) && i !== current && "bg-primary-100 text-primary-700",
              flagged.has(i) && "border-2 border-amber-400",
              !answered.has(i) && i !== current && "bg-gray-100 text-gray-600 hover:bg-gray-200",
              i === current && "bg-primary-600 text-white"
            )}
          >
            {i + 1}
          </button>
        ))}
      </div>
      <div className="mt-6 space-y-2 text-xs text-gray-500">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded bg-primary-100" /> Answered
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded bg-primary-600" /> Current
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded border-2 border-amber-400" /> Flagged
        </div>
      </div>
    </div>
  );
}
