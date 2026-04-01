"use client";

import { useState, useRef, useEffect } from "react";
import katex from "katex";
import type { Submission, Question } from "@/types";
import ProtestForm from "./ProtestForm";

function renderLatexInline(html: string): string {
  return html.replace(
    /\$\$([\s\S]*?)\$\$|\$(.*?)\$/g,
    (match, display, inline) => {
      const tex = display || inline;
      try {
        return katex.renderToString(tex, { displayMode: !!display, throwOnError: false });
      } catch {
        return match;
      }
    }
  );
}

function ExplanationBlock({
  text,
  imageUrl,
  latex,
}: {
  text?: string | null;
  imageUrl?: string | null;
  latex?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current && text && latex) {
      ref.current.innerHTML = renderLatexInline(text);
    }
  }, [text, latex]);

  return (
    <div className="bg-emerald-50 rounded-lg p-4">
      <p className="text-xs font-medium text-emerald-700 uppercase mb-1">Explanation</p>
      {text && (
        latex ? (
          <div ref={ref} className="text-gray-700 text-sm" />
        ) : (
          <p className="text-gray-700 text-sm whitespace-pre-wrap">{text}</p>
        )
      )}
      {imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt="Explanation"
          className="mt-2 max-h-48 rounded border border-gray-200 object-contain"
        />
      )}
    </div>
  );
}

function QuestionStem({ question }: { question: Question }) {
  return (
    <div className="space-y-2">
      {(question.course_level || question.grade_level != null) && (
        <div className="flex flex-wrap gap-2">
          {question.course_level && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
              Level {question.course_level}
            </span>
          )}
          {question.grade_level != null && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
              Grade {question.grade_level}
            </span>
          )}
        </div>
      )}
      {question.question_image_url && (
        <div className="w-fit max-w-full">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={question.question_image_url}
            alt=""
            className="block h-auto w-auto max-h-64 max-w-full rounded-lg border border-gray-200 object-contain"
          />
        </div>
      )}
      {question.content?.trim() ? (
        <p className="text-gray-800 whitespace-pre-wrap">{question.content}</p>
      ) : null}
    </div>
  );
}

interface SubmissionViewProps {
  submission: Submission;
  question: Question;
}

export default function SubmissionView({ submission, question }: SubmissionViewProps) {
  const [showProtest, setShowProtest] = useState(false);

  const scoreColor =
    submission.score !== undefined && submission.score !== null
      ? submission.score >= 8
        ? "text-green-600"
        : submission.score >= 5
        ? "text-yellow-600"
        : "text-red-600"
      : "text-gray-400";

  return (
    <div className="card p-6 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-gray-500 mb-1">
            {question.type === "mcq" ? "Multiple Choice" : "Free Response"}
          </p>
          <QuestionStem question={question} />
        </div>
        <div className="text-right">
          {submission.score !== undefined && submission.score !== null ? (
            <span className={`text-2xl font-bold ${scoreColor}`}>
              {submission.score}
            </span>
          ) : (
            <span className="text-sm text-gray-400">Grading...</span>
          )}
        </div>
      </div>

      <div className="bg-gray-50 rounded-lg p-4">
        <p className="text-xs font-medium text-gray-500 uppercase mb-1">Your Answer</p>
        <p className="text-gray-700">{submission.user_answer}</p>
      </div>

      {submission.feedback && (
        <div className="bg-blue-50 rounded-lg p-4">
          <p className="text-xs font-medium text-blue-600 uppercase mb-1">Feedback</p>
          <p className="text-gray-700">{submission.feedback}</p>
        </div>
      )}

      {submission.justification && (
        <div className="bg-amber-50 rounded-lg p-4">
          <p className="text-xs font-medium text-amber-600 uppercase mb-1">Justification</p>
          <p className="text-gray-700 text-sm">{submission.justification}</p>
        </div>
      )}

      {question.type === "mcq" &&
        (question.explanation || question.explanation_image_url) && (
          <ExplanationBlock
            text={question.explanation}
            imageUrl={question.explanation_image_url}
            latex={question.latex_enabled}
          />
        )}

      {question.type === "frq" && submission.graded_at && (
        <div className="flex justify-end">
          <button
            onClick={() => setShowProtest(!showProtest)}
            className="text-sm text-red-600 hover:text-red-700 font-medium"
          >
            {showProtest ? "Cancel" : "Dispute Grade"}
          </button>
        </div>
      )}

      {showProtest && (
        <ProtestForm
          submissionId={submission.id}
          onSubmitted={() => setShowProtest(false)}
        />
      )}
    </div>
  );
}
