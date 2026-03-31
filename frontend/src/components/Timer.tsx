"use client";

import { useState, useEffect, useCallback } from "react";
import { formatTime } from "@/lib/utils";

interface TimerProps {
  totalSeconds: number;
  onTimeUp: () => void;
  running: boolean;
}

export default function Timer({ totalSeconds, onTimeUp, running }: TimerProps) {
  const [remaining, setRemaining] = useState(totalSeconds);

  useEffect(() => {
    if (!running) return;
    const interval = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          onTimeUp();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [running, onTimeUp]);

  const pct = (remaining / totalSeconds) * 100;
  const isLow = remaining < 300;

  return (
    <div className="flex items-center gap-3">
      <div className="w-32 h-2 bg-gray-200 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-1000 ${
            isLow ? "bg-red-500" : "bg-primary-500"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span
        className={`font-mono text-lg font-semibold tabular-nums ${
          isLow ? "text-red-600" : "text-gray-700"
        }`}
      >
        {formatTime(remaining)}
      </span>
    </div>
  );
}
