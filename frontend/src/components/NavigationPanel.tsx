"use client";

import { cn } from "@/lib/utils";

export interface SetGroup {
  startIndex: number;
  count: number;
}

interface NavigationPanelProps {
  total: number;
  current: number;
  answered: Set<number>;
  flagged: Set<number>;
  onNavigate: (index: number) => void;
  setGroups?: SetGroup[];
}

export default function NavigationPanel({
  total,
  current,
  answered,
  flagged,
  onNavigate,
  setGroups = [],
}: NavigationPanelProps) {
  // Build a lookup: index -> group index (for visual grouping)
  const indexToGroup = new Map<number, number>();
  setGroups.forEach((g, gi) => {
    for (let j = 0; j < g.count; j++) {
      indexToGroup.set(g.startIndex + j, gi);
    }
  });

  const buttons = Array.from({ length: total }, (_, i) => i);

  // Render grouped and ungrouped buttons
  const elements: React.ReactNode[] = [];
  let i = 0;
  while (i < buttons.length) {
    const gi = indexToGroup.get(i);
    if (gi !== undefined) {
      const group = setGroups[gi];
      const groupButtons = buttons.slice(group.startIndex, group.startIndex + group.count);
      elements.push(
        <div
          key={`set-${gi}`}
          className="col-span-5 border-l-2 border-purple-400 pl-2 py-1 my-1 bg-purple-50/50 rounded-r"
        >
          <span className="text-[10px] text-purple-600 font-medium block mb-1">
            Set
          </span>
          <div className="grid grid-cols-5 gap-2">
            {groupButtons.map((idx) => (
              <NavButton
                key={idx}
                index={idx}
                current={current}
                answered={answered}
                flagged={flagged}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        </div>
      );
      i = group.startIndex + group.count;
    } else {
      elements.push(
        <NavButton
          key={i}
          index={i}
          current={current}
          answered={answered}
          flagged={flagged}
          onNavigate={onNavigate}
        />
      );
      i++;
    }
  }

  return (
    <div className="w-64 bg-white border-r border-gray-200 p-4 flex flex-col">
      <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">
        Questions
      </h3>
      <div className="grid grid-cols-5 gap-2">
        {elements}
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

function NavButton({
  index,
  current,
  answered,
  flagged,
  onNavigate,
}: {
  index: number;
  current: number;
  answered: Set<number>;
  flagged: Set<number>;
  onNavigate: (i: number) => void;
}) {
  return (
    <button
      onClick={() => onNavigate(index)}
      className={cn(
        "w-10 h-10 rounded-lg text-sm font-medium transition-all duration-150",
        index === current && "ring-2 ring-primary-500 ring-offset-1",
        answered.has(index) && index !== current && "bg-primary-100 text-primary-700",
        flagged.has(index) && "border-2 border-amber-400",
        !answered.has(index) && index !== current && "bg-gray-100 text-gray-600 hover:bg-gray-200",
        index === current && "bg-primary-600 text-white"
      )}
    >
      {index + 1}
    </button>
  );
}
