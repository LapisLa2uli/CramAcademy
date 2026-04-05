"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { Question } from "@/types";

function poolLabel(pool?: string) {
  if (pool === "community_pending") return "Awaiting review";
  if (pool === "community") return "Published";
  return "Personal";
}

type DisplayItem =
  | { kind: "standalone"; question: Question }
  | { kind: "set"; setId: string; questions: Question[] };

function QuestionBadges({ q }: { q: Question }) {
  return (
    <>
      {!q.subject_id && (
        <span
          title="Missing subject — moderator needs to assign one"
          className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 cursor-help"
        >
          ⚠ missing subject
        </span>
      )}
      {q.type === "mcq" && !q.explanation && !q.explanation_image_url && (
        <span
          title="Missing explanation"
          className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 cursor-help"
        >
          ⚠ missing explanation
        </span>
      )}
    </>
  );
}

export default function MyBankPage() {
  const [items, setItems] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [expandedSet, setExpandedSet] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.questions.myBank();
      setItems(data);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to load bank");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const submitReview = async (id: string) => {
    setBusy(id);
    try {
      await api.questions.submitForReview(id);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Submit failed");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this question from your bank?")) return;
    setBusy(id);
    try {
      await api.questions.delete(id);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(null);
    }
  };

  const displayItems = useMemo<DisplayItem[]>(() => {
    const result: DisplayItem[] = [];
    const setMap = new Map<string, Question[]>();
    const setOrder: string[] = [];

    for (const q of items) {
      if (q.question_set_id) {
        if (!setMap.has(q.question_set_id)) {
          setMap.set(q.question_set_id, []);
          setOrder.push(q.question_set_id);
        }
        setMap.get(q.question_set_id)!.push(q);
      } else {
        result.push({ kind: "standalone", question: q });
      }
    }

    const setItems: DisplayItem[] = setOrder.map((sid) => ({
      kind: "set",
      setId: sid,
      questions: setMap.get(sid)!.sort(
        (a, b) => (a.position_in_set ?? 0) - (b.position_in_set ?? 0)
      ),
    }));

    return [...setItems, ...result];
  }, [items]);

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 mb-2">My question bank</h1>
      <p className="text-gray-600 mb-8 max-w-2xl">
        Questions you create start here. Submit a personal question to the moderation queue when
        you want it considered for the shared community pool.
      </p>

      {loading ? (
        <p className="text-gray-400">Loading…</p>
      ) : displayItems.length === 0 ? (
        <div className="card p-8 text-center text-gray-500">
          No questions yet. Add some from the Contribute tab on the dashboard.
        </div>
      ) : (
        <div className="space-y-4" data-tutorial="bank-list">
          {displayItems.map((item) => {
            if (item.kind === "standalone") {
              const q = item.question;
              return (
                <div
                  key={q.id}
                  className="card p-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="text-xs font-semibold uppercase text-primary-700">
                        {poolLabel(q.pool)}
                      </span>
                      <span className="text-xs text-gray-400">{q.subject}</span>
                      <span className="text-xs text-gray-400">{q.type}</span>
                      <QuestionBadges q={q} />
                    </div>
                    <p className="text-gray-800 line-clamp-3">{q.content || "(image / PDF stem)"}</p>
                    {q.pool === "personal" && q.rejection_reason && (
                      <p className="mt-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                        <span className="font-medium">Rejected:</span> {q.rejection_reason}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 shrink-0">
                    {q.pool === "personal" && (
                      <button
                        type="button"
                        disabled={busy === q.id}
                        onClick={() => submitReview(q.id)}
                        className="btn-primary text-sm"
                        data-tutorial="submit-review-btn"
                      >
                        Submit for review
                      </button>
                    )}
                    {q.pool === "personal" && (
                      <button
                        type="button"
                        disabled={busy === q.id}
                        onClick={() => remove(q.id)}
                        className="btn-secondary text-sm text-red-700 border-red-200"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              );
            }

            // Question set group
            const { setId, questions } = item;
            const isExpanded = expandedSet === setId;
            const firstQ = questions[0];
            const setPool = firstQ.pool;
            const hasAnyMissingSubject = questions.some((q) => !q.subject_id);

            return (
              <div key={`set-${setId}`} className="rounded-xl border-2 border-purple-200 bg-purple-50/50 overflow-hidden">
                {/* Set header */}
                <button
                  type="button"
                  onClick={() => setExpandedSet(isExpanded ? null : setId)}
                  className="w-full text-left p-5 flex items-start justify-between gap-3 hover:bg-purple-50 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs mb-1">
                      <span className="font-semibold text-purple-700 uppercase">
                        Question Set
                      </span>
                      <span className="font-semibold uppercase text-primary-700">
                        {poolLabel(setPool)}
                      </span>
                      <span className="text-gray-500">
                        {questions.length} question{questions.length !== 1 ? "s" : ""}
                      </span>
                      {firstQ.subject && <span className="text-gray-500">{firstQ.subject}</span>}
                      {hasAnyMissingSubject && (
                        <span className="text-amber-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                          ⚠ missing subject
                        </span>
                      )}
                    </div>
                    <p className="text-gray-800 line-clamp-2">
                      {firstQ.context_text || firstQ.content || "(image-based set)"}
                    </p>
                    {setPool === "personal" && firstQ.rejection_reason && (
                      <p className="mt-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                        <span className="font-medium">Rejected:</span> {firstQ.rejection_reason}
                      </p>
                    )}
                  </div>
                  <span className="text-purple-500 text-lg shrink-0 mt-1">
                    {isExpanded ? "▲" : "▼"}
                  </span>
                </button>

                {/* Expanded: show each question */}
                {isExpanded && (
                  <div className="border-t border-purple-200 divide-y divide-purple-100">
                    {questions.map((q, qi) => (
                      <div
                        key={q.id}
                        className="p-4 pl-8 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between bg-white/60"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap gap-2 text-xs text-gray-500 mb-1">
                            <span className="font-medium text-purple-600">Q{qi + 1}</span>
                            <span>{q.type}</span>
                            <QuestionBadges q={q} />
                          </div>
                          <p className="text-gray-800 line-clamp-2 text-sm">
                            {q.content || "(image stem)"}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2 shrink-0">
                          {q.pool === "personal" && (
                            <button
                              type="button"
                              disabled={busy === q.id}
                              onClick={() => submitReview(q.id)}
                              className="btn-primary text-sm"
                            >
                              Submit for review
                            </button>
                          )}
                          {q.pool === "personal" && (
                            <button
                              type="button"
                              disabled={busy === q.id}
                              onClick={() => remove(q.id)}
                              className="btn-secondary text-sm text-red-700 border-red-200"
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
