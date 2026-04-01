"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import Timer from "@/components/Timer";
import NavigationPanel from "@/components/NavigationPanel";
import QuestionRenderer from "@/components/QuestionRenderer";
import type { Test, UserAnswer } from "@/types";

export default function TestPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [test, setTest] = useState<Test | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Map<string, string>>(new Map());
  const [flagged, setFlagged] = useState<Set<number>>(new Set());
  const [started, setStarted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
      return;
    }
    if (!id) return;

    api.tests.get(id).then((data) => {
      setTest(data);
      setLoading(false);
    }).catch(() => {
      setLoading(false);
    });
  }, [id, user, authLoading, router]);

  const handleStart = async () => {
    if (!test) return;
    await api.tests.start(test.id);
    setStarted(true);

    try {
      document.documentElement.requestFullscreen?.();
    } catch {}
  };

  const handleAnswer = (questionId: string, value: string) => {
    setAnswers((prev) => {
      const next = new Map(prev);
      next.set(questionId, value);
      return next;
    });
  };

  const handleSubmit = useCallback(async () => {
    if (!test || submitting) return;
    setSubmitting(true);

    const userAnswers: UserAnswer[] = test.questions.map((q) => ({
      question_id: q.id,
      user_answer: answers.get(q.id) || "",
    }));

    try {
      await api.submissions.submit(test.id, userAnswers);
      document.exitFullscreen?.().catch(() => {});
      router.push(`/results/${test.id}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Submission failed");
      setSubmitting(false);
    }
  }, [test, answers, submitting, router]);

  const toggleFlag = () => {
    setFlagged((prev) => {
      const next = new Set(prev);
      if (next.has(currentIndex)) next.delete(currentIndex);
      else next.add(currentIndex);
      return next;
    });
  };

  if (loading || authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-gray-400">Loading test...</div>
      </div>
    );
  }

  if (!test) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500">Test not found.</p>
      </div>
    );
  }

  if (!started) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="card p-10 text-center space-y-6 max-w-md">
          <h1 className="text-2xl font-bold text-gray-900">Ready to Begin?</h1>
          <div className="text-gray-600 space-y-2">
            <p><strong>Subject:</strong> {test.subject}</p>
            {test.course_level && (
              <p><strong>Level:</strong> {test.course_level}</p>
            )}
            {test.grade_level != null && (
              <p><strong>Grade:</strong> {test.grade_level}</p>
            )}
            <p><strong>Questions:</strong> {test.questions.length}</p>
            <p>
              <strong>Time Limit:</strong> {Math.floor(test.time_limit_seconds / 60)} minutes
            </p>
          </div>
          <p className="text-sm text-gray-400">
            The browser will enter fullscreen mode. Your timer starts immediately.
          </p>
          <button onClick={handleStart} className="btn-primary w-full text-lg py-3">
            Start Test
          </button>
        </div>
      </div>
    );
  }

  const currentQuestion = test.questions[currentIndex];
  const answeredSet = new Set(
    test.questions
      .map((q, i) => (answers.has(q.id) && answers.get(q.id) ? i : -1))
      .filter((i) => i >= 0)
  );

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Top Bar */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <span className="text-lg font-semibold text-gray-800">
            CramAcademy
          </span>
          <span className="text-sm text-gray-400">|</span>
          <span className="text-sm text-gray-500">
            {test.subject}
            {test.course_level ? ` · ${test.course_level}` : ""}
            {test.grade_level != null ? ` · G${test.grade_level}` : ""}
          </span>
        </div>
        <Timer
          totalSeconds={test.time_limit_seconds}
          onTimeUp={handleSubmit}
          running={true}
        />
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="btn-primary text-sm"
        >
          {submitting ? "Submitting..." : "Submit Test"}
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left Navigation */}
        <NavigationPanel
          total={test.questions.length}
          current={currentIndex}
          answered={answeredSet}
          flagged={flagged}
          onNavigate={setCurrentIndex}
        />

        {/* Main Content */}
        <div className="flex-1 overflow-y-auto p-8">
          <div className="max-w-3xl mx-auto">
            <QuestionRenderer
              question={currentQuestion}
              index={currentIndex}
              answer={answers.get(currentQuestion.id) || ""}
              onAnswer={(val) => handleAnswer(currentQuestion.id, val)}
            />

            {/* Navigation Buttons */}
            <div className="flex items-center justify-between mt-10 pt-6 border-t border-gray-200">
              {currentIndex > 0 ? (
                <button
                  onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
                  className="btn-secondary"
                >
                  Previous
                </button>
              ) : (
                <span />
              )}

              <button
                onClick={toggleFlag}
                className={`text-sm font-medium px-4 py-2 rounded-lg transition-colors ${
                  flagged.has(currentIndex)
                    ? "bg-amber-100 text-amber-700"
                    : "text-gray-500 hover:bg-gray-100"
                }`}
              >
                {flagged.has(currentIndex) ? "Unflag" : "Flag for Review"}
              </button>

              {currentIndex < test.questions.length - 1 ? (
                <button
                  onClick={() =>
                    setCurrentIndex((i) => Math.min(test.questions.length - 1, i + 1))
                  }
                  className="btn-primary"
                >
                  Next
                </button>
              ) : (
                <button
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="btn-primary bg-emerald-600 hover:bg-emerald-700 focus:ring-emerald-500"
                >
                  {submitting ? "Submitting…" : "Submit Test"}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
