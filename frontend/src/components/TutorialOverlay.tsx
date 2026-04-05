"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import type { TutorialStep } from "@/lib/tutorialSteps";

interface TutorialOverlayProps {
  steps: TutorialStep[];
  onClose: () => void;
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PAD = 6;
const TOOLTIP_GAP = 12;
const TOOLTIP_WIDTH = 320;

/** Check if a step's target element exists and is visible in the DOM. */
function stepElementExists(step: TutorialStep): boolean {
  const el = document.querySelector(step.selector);
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

/** Find the next valid step index in the given direction. Returns -1 if none found. */
function findVisibleStep(steps: TutorialStep[], from: number, direction: 1 | -1): number {
  let i = from;
  while (i >= 0 && i < steps.length) {
    if (stepElementExists(steps[i])) return i;
    i += direction;
  }
  return -1;
}

/** Clamp a tooltip so it stays inside the viewport. */
function clampToViewport(style: React.CSSProperties): React.CSSProperties {
  const out = { ...style };
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  if (typeof out.left === "number") {
    if (out.left < 8) out.left = 8;
    if (out.left + TOOLTIP_WIDTH > vw - 8) out.left = vw - TOOLTIP_WIDTH - 8;
  }
  if (typeof out.top === "number") {
    if (out.top < 8) out.top = 8;
    if (out.top > vh - 160) out.top = vh - 160;
  }

  return out;
}

export default function TutorialOverlay({ steps, onClose }: TutorialOverlayProps) {
  const [current, setCurrent] = useState(() => {
    // Start at the first step whose element is visible
    const idx = findVisibleStep(steps, 0, 1);
    return idx >= 0 ? idx : 0;
  });
  const [targetRect, setTargetRect] = useState<Rect | null>(null);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const step = steps[current];

  const measure = useCallback(() => {
    if (!step) return;
    const el = document.querySelector(step.selector);
    if (!el) {
      setTargetRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) {
      setTargetRect(null);
      return;
    }
    setTargetRect({
      top: r.top - PAD,
      left: r.left - PAD,
      width: r.width + PAD * 2,
      height: r.height + PAD * 2,
    });
  }, [step]);

  // Debounced measure for scroll events
  const measureOnScroll = useCallback(() => {
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    scrollTimeoutRef.current = setTimeout(measure, 60);
  }, [measure]);

  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measureOnScroll, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measureOnScroll, true);
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    };
  }, [measure, measureOnScroll]);

  // When step changes, scroll into view if needed and re-measure
  useEffect(() => {
    measure();
    const el = step ? document.querySelector(step.selector) : null;
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.top < 60 || r.bottom > window.innerHeight - 20) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        const t = setTimeout(measure, 400);
        return () => clearTimeout(t);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  const goNext = () => {
    const nextIdx = findVisibleStep(steps, current + 1, 1);
    if (nextIdx >= 0) {
      setCurrent(nextIdx);
    } else {
      // No more visible steps — finish
      onClose();
    }
  };

  const goPrev = () => {
    const prevIdx = findVisibleStep(steps, current - 1, -1);
    if (prevIdx >= 0) {
      setCurrent(prevIdx);
    }
  };

  // Check if there's a visible step after the current one
  const hasNextVisible = findVisibleStep(steps, current + 1, 1) >= 0;
  const hasPrevVisible = findVisibleStep(steps, current - 1, -1) >= 0;

  // Count visible steps for display
  const visibleSteps = steps.filter((s) => stepElementExists(s));
  const visibleIndex = visibleSteps.indexOf(step);

  const tooltipStyle = (): React.CSSProperties => {
    if (!targetRect) {
      return {
        position: "fixed",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        maxWidth: TOOLTIP_WIDTH,
      };
    }

    const pos = step.position;
    const style: React.CSSProperties = { position: "fixed", maxWidth: TOOLTIP_WIDTH };

    if (pos === "bottom") {
      style.top = targetRect.top + targetRect.height + TOOLTIP_GAP;
      style.left = targetRect.left + targetRect.width / 2;
      style.transform = "translateX(-50%)";
    } else if (pos === "top") {
      style.top = targetRect.top - TOOLTIP_GAP - 120;
      if (typeof style.top === "number" && style.top < 8) {
        style.top = targetRect.top + targetRect.height + TOOLTIP_GAP;
      }
      style.left = targetRect.left + targetRect.width / 2;
      style.transform = "translateX(-50%)";
    } else if (pos === "right") {
      style.top = targetRect.top + targetRect.height / 2;
      style.left = targetRect.left + targetRect.width + TOOLTIP_GAP;
      style.transform = "translateY(-50%)";
      if (typeof style.left === "number" && style.left + TOOLTIP_WIDTH > window.innerWidth - 8) {
        // Fallback to left
        style.left = targetRect.left - TOOLTIP_GAP - TOOLTIP_WIDTH;
      }
    } else {
      style.top = targetRect.top + targetRect.height / 2;
      style.left = targetRect.left - TOOLTIP_GAP - TOOLTIP_WIDTH;
      if (typeof style.left === "number" && style.left < 8) {
        style.left = targetRect.left + targetRect.width + TOOLTIP_GAP;
      }
      style.transform = "translateY(-50%)";
    }

    return clampToViewport(style);
  };

  const overlay = (
    <div
      className="fixed inset-0"
      style={{ zIndex: 9998 }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Dark backdrop with cutout */}
      {targetRect ? (
        <div
          className="fixed rounded-lg transition-all duration-200 ease-out"
          style={{
            top: targetRect.top,
            left: targetRect.left,
            width: targetRect.width,
            height: targetRect.height,
            boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.5)",
            zIndex: 9998,
            pointerEvents: "none",
          }}
        />
      ) : (
        <div
          className="fixed inset-0"
          style={{ backgroundColor: "rgba(0, 0, 0, 0.5)", zIndex: 9998 }}
        />
      )}

      {/* Tooltip */}
      <div
        className="bg-white rounded-xl shadow-2xl p-4 space-y-3 transition-all duration-200 ease-out"
        style={{ ...tooltipStyle(), zIndex: 9999 }}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm text-gray-800 leading-relaxed">{step?.content}</p>
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-gray-400">
            {visibleIndex >= 0 ? visibleIndex + 1 : current + 1} / {visibleSteps.length || steps.length}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1"
            >
              Skip
            </button>
            {hasPrevVisible && (
              <button
                type="button"
                onClick={goPrev}
                className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-md"
              >
                Previous
              </button>
            )}
            <button
              type="button"
              onClick={goNext}
              className="text-xs bg-primary-600 hover:bg-primary-700 text-white px-3 py-1.5 rounded-md font-medium"
            >
              {hasNextVisible ? "Next" : "Finish"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
