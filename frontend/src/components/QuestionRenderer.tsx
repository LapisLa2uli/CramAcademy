"use client";

import { useEffect, useRef } from "react";
import katex from "katex";
import type { Question } from "@/types";
import LatexEditor from "./LatexEditor";

interface QuestionRendererProps {
  question: Question;
  index: number;
  answer: string;
  onAnswer: (value: string) => void;
  contextText?: string;
  contextImageUrl?: string | null;
}

function renderLatex(html: string): string {
  return html.replace(
    /\$\$([\s\S]*?)\$\$|\$(.*?)\$/g,
    (match, display, inline) => {
      const tex = display || inline;
      try {
        return katex.renderToString(tex, {
          displayMode: !!display,
          throwOnError: false,
        });
      } catch {
        return match;
      }
    }
  );
}

function LevelGradeBadges({ question }: { question: Question }) {
  const parts: string[] = [];
  if (question.course_level) parts.push(`Level ${question.course_level}`);
  if (question.grade_level != null) parts.push(`Grade ${question.grade_level}`);
  if (parts.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 mb-2">
      {parts.map((p) => (
        <span
          key={p}
          className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 font-medium"
        >
          {p}
        </span>
      ))}
    </div>
  );
}

function shouldUseSplitLayout(
  question: Question,
  contextText?: string,
  contextImageUrl?: string | null
): boolean {
  if (contextText) return true;
  if (contextImageUrl) return true;
  if (question.question_image_url) return true;
  if ((question.content?.length ?? 0) > 300) return true;
  return false;
}

export default function QuestionRenderer({
  question,
  index,
  answer,
  onAnswer,
  contextText,
  contextImageUrl,
}: QuestionRendererProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const contextRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (contentRef.current && question.latex_enabled) {
      contentRef.current.innerHTML = renderLatex(question.content);
    }
  }, [question.content, question.latex_enabled]);

  useEffect(() => {
    if (contextRef.current && contextText) {
      const hasLatex = /\$.*?\$/.test(contextText);
      if (hasLatex) {
        contextRef.current.innerHTML = renderLatex(contextText);
      }
    }
  }, [contextText]);

  const split = shouldUseSplitLayout(question, contextText, contextImageUrl);

  // --- Shared sub-components ---

  const questionHeader = (
    <div className="flex items-start gap-4">
      <span className="flex-shrink-0 w-8 h-8 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-sm font-semibold">
        {index + 1}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className="text-xs font-medium uppercase tracking-wider text-gray-400">
            {question.type === "mcq" ? "Multiple Choice" : "Free Response"}
          </span>
          {question.latex_enabled && (
            <span className="text-xs px-1.5 py-0.5 bg-purple-50 text-purple-600 rounded">
              LaTeX
            </span>
          )}
        </div>
        <LevelGradeBadges question={question} />
      </div>
    </div>
  );

  const questionStem = (
    <>
      {!split && question.question_image_url && (
        <div className="mb-3 w-fit max-w-full">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={question.question_image_url}
            alt="Question figure"
            className="block h-auto w-auto max-h-80 max-w-full rounded-lg border border-gray-200 object-contain bg-white"
          />
        </div>
      )}
      {question.latex_enabled ? (
        <div ref={contentRef} className="text-gray-800 text-base leading-relaxed" />
      ) : question.content?.trim() ? (
        <p className="text-gray-800 text-base leading-relaxed whitespace-pre-wrap">
          {question.content}
        </p>
      ) : null}
    </>
  );

  const answerArea = (
    <>
      {question.type === "mcq" && question.options && (
        <div className="space-y-2">
          {question.options.map((opt) => (
            <label
              key={opt.label}
              className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all
                ${
                  answer === opt.label
                    ? "border-primary-500 bg-primary-50"
                    : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                }`}
            >
              <input
                type="radio"
                name={`q-${question.id}`}
                value={opt.label}
                checked={answer === opt.label}
                onChange={() => onAnswer(opt.label)}
                className="w-4 h-4 mt-1 text-primary-600 focus:ring-primary-500 shrink-0"
              />
              <span className="font-medium text-gray-600 w-6 shrink-0">{opt.label}.</span>
              <div className="flex flex-col gap-2 min-w-0 flex-1 items-start">
                {opt.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={opt.image_url}
                    alt={`Option ${opt.label}`}
                    className="block h-auto w-auto max-h-44 max-w-[min(100%,22rem)] shrink-0 rounded border border-gray-200 object-contain bg-white"
                  />
                ) : null}
                {opt.text ? (
                  <span className="text-gray-800">{opt.text}</span>
                ) : null}
              </div>
            </label>
          ))}
        </div>
      )}

      {question.type === "frq" && (
        <div>
          {question.latex_enabled ? (
            <LatexEditor value={answer} onChange={onAnswer} />
          ) : (
            <textarea
              value={answer}
              onChange={(e) => onAnswer(e.target.value)}
              placeholder="Type your answer here..."
              className="input-field min-h-[200px] resize-y"
            />
          )}
        </div>
      )}
    </>
  );

  // --- Split layout ---
  if (split) {
    return (
      <div className="flex flex-col h-full">
        {questionHeader}

        <div className="flex flex-col md:flex-row gap-6 ml-0 md:ml-12 mt-4 flex-1 min-h-0">
          {/* Left panel: context / passage / image */}
          <div className="w-full md:w-1/2 md:overflow-y-auto space-y-4 pr-2">
            {contextImageUrl && (
              <div className="w-fit max-w-full">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={contextImageUrl}
                  alt="Context figure"
                  className="block h-auto w-auto max-w-full rounded-lg border border-gray-200 object-contain bg-white"
                />
              </div>
            )}
            {contextText && (
              /\$.*?\$/.test(contextText) ? (
                <div
                  ref={contextRef}
                  className="text-gray-800 text-base leading-relaxed prose prose-sm max-w-none"
                />
              ) : (
                <p className="text-gray-800 text-base leading-relaxed whitespace-pre-wrap">
                  {contextText}
                </p>
              )
            )}
            {question.question_image_url && (
              <div className="w-fit max-w-full">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={question.question_image_url}
                  alt="Question figure"
                  className="block h-auto w-auto max-w-full rounded-lg border border-gray-200 object-contain bg-white"
                />
              </div>
            )}
            {/* If no context but long text triggered split, show the text here */}
            {!contextText && !contextImageUrl && question.content && (question.content.length > 300) && (
              question.latex_enabled ? (
                <div ref={contentRef} className="text-gray-800 text-base leading-relaxed" />
              ) : (
                <p className="text-gray-800 text-base leading-relaxed whitespace-pre-wrap">
                  {question.content}
                </p>
              )
            )}
          </div>

          {/* Right panel: question stem (if context mode) + choices/answer */}
          <div className="w-full md:w-1/2 md:overflow-y-auto space-y-4">
            {/* Show question stem on right when context is on left */}
            {(contextText || contextImageUrl) && question.content?.trim() && (
              question.latex_enabled ? (
                <div ref={contentRef} className="text-gray-800 text-base leading-relaxed font-medium" />
              ) : (
                <p className="text-gray-800 text-base leading-relaxed font-medium whitespace-pre-wrap">
                  {question.content}
                </p>
              )
            )}
            {answerArea}
          </div>
        </div>
      </div>
    );
  }

  // --- Normal (linear) layout ---
  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4">
        <span className="flex-shrink-0 w-8 h-8 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-sm font-semibold">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-xs font-medium uppercase tracking-wider text-gray-400">
              {question.type === "mcq" ? "Multiple Choice" : "Free Response"}
            </span>
            {question.latex_enabled && (
              <span className="text-xs px-1.5 py-0.5 bg-purple-50 text-purple-600 rounded">
                LaTeX
              </span>
            )}
          </div>
          <LevelGradeBadges question={question} />
          {questionStem}
        </div>
      </div>

      <div className="ml-12">
        {answerArea}
      </div>
    </div>
  );
}
