"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import Timer from "@/components/Timer";
import TutorialButton from "@/components/TutorialButton";
import NavigationPanel, { type SetGroup } from "@/components/NavigationPanel";
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
  const [loadProgress, setLoadProgress] = useState(0);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
      return;
    }
    if (!id) return;

    setLoadProgress(10);
    api.tests.get(id).then((data) => {
      // Simulate progressive loading for UX
      const total = data.questions.length;
      let loaded = 0;
      const step = () => {
        loaded = Math.min(loaded + Math.ceil(total / 5), total);
        setLoadProgress(10 + (loaded / total) * 90);
        if (loaded < total) {
          requestAnimationFrame(step);
        } else {
          setTest(data);
          setLoading(false);
        }
      };
      requestAnimationFrame(step);
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

  // Compute question set groups for navigation panel
  const setGroups = useMemo<SetGroup[]>(() => {
    if (!test) return [];
    const groups: SetGroup[] = [];
    let i = 0;
    while (i < test.questions.length) {
      const sid = test.questions[i].question_set_id;
      if (sid) {
        const start = i;
        while (i < test.questions.length && test.questions[i].question_set_id === sid) {
          i++;
        }
        groups.push({ startIndex: start, count: i - start });
      } else {
        i++;
      }
    }
    return groups;
  }, [test]);

  if (loading || authLoading) {
    const totalQ = test?.questions.length;
    const loadedQ = totalQ ? Math.round((loadProgress / 100) * totalQ) : 0;
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <div className="w-64">
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary-500 rounded-full transition-all duration-200"
              style={{ width: `${loadProgress}%` }}
            />
          </div>
          <p className="text-sm text-gray-500 mt-2 text-center">
            {totalQ
              ? `Loading questions... ${loadedQ} / ${totalQ}`
              : "Loading test..."}
          </p>
        </div>
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

  // Determine if current question uses split layout (wider container needed)
  const useSplit =
    !!currentQuestion.context_text ||
    !!currentQuestion.context_image_url ||
    !!currentQuestion.question_image_url ||
    (currentQuestion.content?.length ?? 0) > 300;

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
        <div className="flex items-center gap-3">
          <div data-tutorial="test-timer">
            <Timer
              totalSeconds={test.time_limit_seconds}
              onTimeUp={handleSubmit}
              running={true}
            />
          </div>
          <TutorialButton />
        </div>
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="btn-primary text-sm"
          data-tutorial="submit-test-btn"
        >
          {submitting ? "Submitting..." : "Submit Test"}
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left Navigation */}
        <div data-tutorial="nav-panel">
          <NavigationPanel
            total={test.questions.length}
            current={currentIndex}
            answered={answeredSet}
            flagged={flagged}
            onNavigate={setCurrentIndex}
            setGroups={setGroups}
          />
        </div>

        {/* Main Content */}
        <div className={`flex-1 flex flex-col ${useSplit ? "" : "overflow-y-auto"} p-8`}>
          <div className={`${useSplit ? "max-w-6xl flex-1 min-h-0" : "max-w-3xl"} mx-auto w-full`}>
            <QuestionRenderer
              question={currentQuestion}
              index={currentIndex}
              answer={answers.get(currentQuestion.id) || ""}
              onAnswer={(val) => handleAnswer(currentQuestion.id, val)}
              contextText={currentQuestion.context_text ?? undefined}
              contextImageUrl={currentQuestion.context_image_url ?? undefined}
            />
          </div>

          {/* Navigation Buttons */}
          <div className={`${useSplit ? "max-w-6xl" : "max-w-3xl"} mx-auto w-full flex items-center justify-between ${useSplit ? "pt-3 mt-auto border-t border-gray-200 shrink-0" : "mt-10 pt-6 border-t border-gray-200"}`}>
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
              data-tutorial="flag-btn"
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
  );
}
