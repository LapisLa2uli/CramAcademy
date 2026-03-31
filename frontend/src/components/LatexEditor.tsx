"use client";

import { useState, useEffect, useRef } from "react";
import katex from "katex";

interface LatexEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export default function LatexEditor({
  value,
  onChange,
  placeholder = "Type your answer here. Use LaTeX for math: $x^2$, \\frac{a}{b}, etc.",
}: LatexEditorProps) {
  const [preview, setPreview] = useState("");
  const previewRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(() => {
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
        setPreview(rendered);
      } catch {
        setPreview(value);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value]);

  return (
    <div className="grid grid-cols-2 gap-4 h-full">
      <div className="flex flex-col">
        <label className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
          Input
        </label>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1 input-field font-mono text-sm resize-none min-h-[200px]"
          spellCheck={false}
        />
      </div>
      <div className="flex flex-col">
        <label className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
          Preview
        </label>
        <div
          ref={previewRef}
          className="flex-1 p-4 bg-white rounded-lg border border-gray-200 overflow-auto prose prose-sm min-h-[200px]"
          dangerouslySetInnerHTML={{ __html: preview || '<span class="text-gray-400">Preview will appear here...</span>' }}
        />
      </div>
    </div>
  );
}
