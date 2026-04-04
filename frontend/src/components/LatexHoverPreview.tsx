"use client";

import { useEffect, useState } from "react";
import katex from "katex";

/**
 * Wraps a text input/textarea. When the value contains `$...$` or `$$...$$`,
 * a persistent inline preview of the rendered LaTeX is shown below the input.
 */
export default function LatexHoverPreview({
  value,
  children,
}: {
  value: string;
  children: React.ReactNode;
}) {
  const [html, setHtml] = useState("");
  const [collapsed, setCollapsed] = useState(false);

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
    <div className="space-y-1">
      {children}
      {html && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 overflow-hidden">
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="flex items-center gap-1.5 w-full px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          >
            <span className="inline-block transition-transform" style={{ transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)" }}>
              &#9662;
            </span>
            LaTeX Preview
          </button>
          {!collapsed && (
            <div
              className="px-3 pb-2 text-sm text-gray-800 prose prose-sm max-h-48 overflow-auto"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )}
        </div>
      )}
    </div>
  );
}
