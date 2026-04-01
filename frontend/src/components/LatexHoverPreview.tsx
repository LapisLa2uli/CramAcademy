"use client";

import { useEffect, useRef, useState } from "react";
import katex from "katex";

/**
 * Wraps a text input/textarea. When the user hovers over an inline `$...$`
 * expression in the rendered preview tooltip, they see the LaTeX rendered.
 * This component shows a floating preview near the mouse when hovering over
 * the input and it contains `$...$`.
 */
export default function LatexHoverPreview({
  value,
  children,
}: {
  value: string;
  children: React.ReactNode;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [show, setShow] = useState(false);
  const [html, setHtml] = useState("");

  const hasLatex = /\$.*?\$/.test(value);

  useEffect(() => {
    if (!hasLatex) {
      setHtml("");
      return;
    }
    try {
      const rendered = value.replace(
        /\$\$([\s\S]*?)\$\$|\$(.*?)\$/g,
        (match, display, inline) => {
          const tex = display || inline;
          return katex.renderToString(tex, {
            displayMode: !!display,
            throwOnError: false,
          });
        }
      );
      setHtml(rendered);
    } catch {
      setHtml(value);
    }
  }, [value, hasLatex]);

  if (!hasLatex) return <>{children}</>;

  return (
    <div
      ref={wrapRef}
      className="relative"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && html && (
        <div
          ref={tipRef}
          className="absolute z-40 left-0 right-0 top-full mt-1 p-3 bg-white border border-gray-300 rounded-lg shadow-lg text-sm text-gray-800 prose prose-sm max-h-48 overflow-auto"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </div>
  );
}
