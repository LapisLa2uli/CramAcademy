"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { getTutorialForPath } from "@/lib/tutorialSteps";
import TutorialOverlay from "./TutorialOverlay";

export default function TutorialButton() {
  const pathname = usePathname();
  const [active, setActive] = useState(false);
  const [toast, setToast] = useState(false);

  const handleClick = () => {
    const steps = getTutorialForPath(pathname);
    if (!steps || steps.length === 0) {
      setToast(true);
      setTimeout(() => setToast(false), 2000);
      return;
    }
    setActive(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        title="Page tutorial"
        className="relative w-8 h-8 rounded-full border border-gray-300 bg-white text-gray-600 hover:bg-gray-100 hover:text-gray-900 flex items-center justify-center text-sm font-bold transition-colors shrink-0"
      >
        ?
        {toast && (
          <span className="absolute -bottom-9 left-1/2 -translate-x-1/2 whitespace-nowrap text-xs bg-gray-800 text-white px-2 py-1 rounded shadow-lg">
            No tutorial for this page
          </span>
        )}
      </button>
      {active && (
        <TutorialOverlay
          steps={getTutorialForPath(pathname)!}
          onClose={() => setActive(false)}
        />
      )}
    </>
  );
}
