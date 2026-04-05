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

export default function TutorialOverlay({ steps, onClose }: TutorialOverlayProps) {
  const [current, setCurrent] = useState(0);
  const [targetRect, setTargetRect] = useState<Rect | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const step = steps[current];

  const measure = useCallback(() => {
    if (!step) return;
    const el = document.querySelector(step.selector);
    if (!el) {
      setTargetRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setTargetRect({
      top: r.top - PAD,
      left: r.left - PAD,
      width: r.width + PAD * 2,
      height: r.height + PAD * 2,
    });
    // Scroll element into view if needed
    if (r.top < 0 || r.bottom > window.innerHeight) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [step]);

  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [measure]);

  // Re-measure when step changes
  useEffect(() => {
    // Small delay to let DOM settle (e.g., after scrollIntoView)
    const t = setTimeout(measure, 100);
    return () => clearTimeout(t);
  }, [current, measure]);

  const goNext = () => {
    if (current < steps.length - 1) {
      setCurrent(current + 1);
    } else {
      onClose();
    }
  };

  const goPrev = () => {
    if (current > 0) setCurrent(current - 1);
  };

  // Compute tooltip position
  const tooltipStyle = (): React.CSSProperties => {
    if (!targetRect) {
      return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
    }

    const pos = step.position;
    const style: React.CSSProperties = { position: "fixed", maxWidth: 320 };

    if (pos === "bottom") {
      style.top = targetRect.top + targetRect.height + TOOLTIP_GAP;
      style.left = targetRect.left + targetRect.width / 2;
      style.transform = "translateX(-50%)";
    } else if (pos === "top") {
      style.bottom = window.innerHeight - targetRect.top + TOOLTIP_GAP;
      style.left = targetRect.left + targetRect.width / 2;
      style.transform = "translateX(-50%)";
    } else if (pos === "right") {
      style.top = targetRect.top + targetRect.height / 2;
      style.left = targetRect.left + targetRect.width + TOOLTIP_GAP;
      style.transform = "translateY(-50%)";
    } else {
      // left
      style.top = targetRect.top + targetRect.height / 2;
      style.right = window.innerWidth - targetRect.left + TOOLTIP_GAP;
      style.transform = "translateY(-50%)";
    }

    return style;
  };

  const overlay = (
    <div
      className="fixed inset-0"
      style={{ zIndex: 9998 }}
      onClick={(e) => {
        // Close if clicking the backdrop (not the tooltip or highlight)
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Dark backdrop with cutout */}
      {targetRect ? (
        <div
          className="fixed rounded-lg"
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
        ref={tooltipRef}
        className="bg-white rounded-xl shadow-2xl p-4 space-y-3"
        style={{ ...tooltipStyle(), zIndex: 9999 }}
        onClick={(e) => e.stopPropagation()}
      >
        {!targetRect && step && (
          <p className="text-xs text-amber-600">
            (Element not visible on this page — it may appear after an action.)
          </p>
        )}
        <p className="text-sm text-gray-800 leading-relaxed">{step?.content}</p>
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-gray-400">
            {current + 1} / {steps.length}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1"
            >
              Skip
            </button>
            {current > 0 && (
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
              {current < steps.length - 1 ? "Next" : "Finish"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
