"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import SubmissionView from "@/components/SubmissionView";
import type { Test, Submission, Question } from "@/types";

export default function ResultsPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [test, setTest] = useState<Test | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
      return;
    }
    if (!id) return;

    Promise.all([api.tests.get(id), api.submissions.getForTest(id)])
      .then(([testData, subsData]) => {
        setTest(testData);
        setSubmissions(subsData);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [id, user, authLoading, router]);

  // Poll for grading updates on FRQs
  useEffect(() => {
    if (!id) return;
    const ungradedFRQs = submissions.filter(
      (s) => s.score === null || s.score === undefined
    );
    if (ungradedFRQs.length === 0) return;

    const interval = setInterval(async () => {
      const updated = await api.submissions.getForTest(id);
      setSubmissions(updated);
      const stillUngraded = updated.filter(
        (s) => s.score === null || s.score === undefined
      );
      if (stillUngraded.length === 0) clearInterval(interval);
    }, 5000);

    return () => clearInterval(interval);
  }, [id, submissions]);

  if (loading || authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-gray-400">Loading results...</div>
      </div>
    );
  }

  if (!test) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500">Results not found.</p>
      </div>
    );
  }

  const questionMap = new Map<string, Question>(
    test.questions.map((q) => [q.id, q])
  );

  const totalScore = submissions.reduce((acc, s) => acc + (s.score || 0), 0);
  const gradedCount = submissions.filter(
    (s) => s.score !== null && s.score !== undefined
  ).length;
  const maxPossible = gradedCount > 0 ? gradedCount : 1;
  const pctScore = gradedCount > 0 ? (totalScore / maxPossible) * 100 : 0;

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/dashboard" className="text-xl font-bold text-primary-700">
            CramAcademy
          </Link>
          <Link href="/dashboard" className="btn-secondary text-sm">
            Back to Dashboard
          </Link>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-6 py-10">
        {/* Summary */}
        <div className="card p-8 mb-8" data-tutorial="results-summary">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 mb-1">Test Results</h1>
              <p className="text-gray-500">
                {test.subject}
                {test.course_level ? ` · Level ${test.course_level}` : ""}
                {test.grade_level != null ? ` · Grade ${test.grade_level}` : ""}
                {" "}
                &middot;{" "}
                {test.finished_at
                  ? new Date(test.finished_at).toLocaleString()
                  : "Not submitted"}
              </p>
            </div>
            <div className="text-right">
              <p className="text-4xl font-bold text-primary-600">
                {totalScore.toFixed(1)}{" "}
                <span className="text-xl text-gray-400 font-medium">/ {gradedCount}</span>
              </p>
              <p className="text-lg font-semibold text-gray-700">
                {pctScore.toFixed(2)}%
              </p>
              <p className="text-sm text-gray-500">
                {gradedCount}/{submissions.length} graded
              </p>
            </div>
          </div>
        </div>

        {/* Submissions */}
        <div className="space-y-4" data-tutorial="results-questions">
          {submissions.map((sub) => {
            const question = questionMap.get(sub.question_id);
            if (!question) return null;
            return (
              <SubmissionView
                key={sub.id}
                submission={sub}
                question={question}
              />
            );
          })}
        </div>
      </main>
    </div>
  );
}
