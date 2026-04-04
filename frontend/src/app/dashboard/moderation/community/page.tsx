"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import type { Question } from "@/types";

/** A standalone question or a group of questions from the same set. */
type DisplayItem =
  | { kind: "standalone"; question: Question }
  | { kind: "set"; setId: string; questions: Question[] };

function QuestionBadges({ q }: { q: Question }) {
  return (
    <>
      {!q.subject_id && (
        <span
          title="Missing subject — assign via Edit"
          className="text-amber-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 cursor-help"
        >
          ⚠ missing subject
        </span>
      )}
      {q.type === "mcq" && !q.explanation && !q.explanation_image_url && (
        <span
          title="Missing explanation"
          className="text-amber-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 cursor-help"
        >
          ⚠ missing explanation
        </span>
      )}
    </>
  );
}

export default function ModerationCommunityBankPage() {
  const { profile } = useAuth();
  const [items, setItems] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [expandedSet, setExpandedSet] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.questions.communityBank();
      setItems(data);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to load community bank");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (profile?.role === "moderator" || profile?.role === "admin") {
      load();
    }
  }, [profile?.role, load]);

  const remove = async (id: string) => {
    if (
      !confirm(
        "Remove this question from the community bank? It will be deleted permanently (including from past tests that reference it may break — use with care)."
      )
    ) {
      return;
    }
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

  // Group questions: sets together, standalone separate, preserving order
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
        // Flush any pending sets that appeared before this standalone
        // (maintain rough chronological order)
        result.push({ kind: "standalone", question: q });
      }
    }

    // Insert set groups — we'll interleave them at the top since community bank
    // is sorted by created_at desc and sets tend to be created together
    const setItems: DisplayItem[] = setOrder.map((sid) => ({
      kind: "set",
      setId: sid,
      questions: setMap.get(sid)!.sort(
        (a, b) => (a.position_in_set ?? 0) - (b.position_in_set ?? 0)
      ),
    }));

    return [...setItems, ...result];
  }, [items]);

  if (profile?.role !== "moderator" && profile?.role !== "admin") {
    return (
      <p className="text-gray-600">You need the moderator or admin role to access this page.</p>
    );
  }

  return (
    <>
      <p className="text-gray-600 mb-8">
        Published community questions. Delete entries that are duplicates, erroneous, or should no
        longer be in the shared pool. Prefer editing from the queue before approval when possible.
      </p>

      {loading ? (
        <p className="text-gray-400">Loading…</p>
      ) : displayItems.length === 0 ? (
        <div className="card p-8 text-center text-gray-500">No published community questions.</div>
      ) : (
        <div className="space-y-4">
          {displayItems.map((item) => {
            if (item.kind === "standalone") {
              const q = item.question;
              return (
                <div
                  key={q.id}
                  className="card p-5 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap gap-2 text-xs text-gray-500 mb-1">
                      <span>{q.subject}</span>
                      <span>{q.type}</span>
                      <span>{q.difficulty}</span>
                      <span className="text-emerald-600">published</span>
                      <QuestionBadges q={q} />
                    </div>
                    <p className="text-gray-800 line-clamp-3">{q.content || "(image stem)"}</p>
                  </div>
                  <div className="flex flex-wrap gap-2 shrink-0">
                    <Link href={`/dashboard/moderation/${q.id}`} className="btn-secondary text-sm">
                      Edit
                    </Link>
                    <button
                      type="button"
                      disabled={busy === q.id}
                      onClick={() => remove(q.id)}
                      className="btn-secondary text-sm text-red-700 border-red-200"
                    >
                      Delete from bank
                    </button>
                  </div>
                </div>
              );
            }

            // Question set group
            const { setId, questions } = item;
            const isExpanded = expandedSet === setId;
            const firstQ = questions[0];
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
                      <span className="text-gray-500">{questions.length} question{questions.length !== 1 ? "s" : ""}</span>
                      {firstQ.subject && <span className="text-gray-500">{firstQ.subject}</span>}
                      <span className="text-gray-500">{firstQ.difficulty}</span>
                      <span className="text-emerald-600 text-xs">published</span>
                      {hasAnyMissingSubject && (
                        <span className="text-amber-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                          ⚠ missing subject
                        </span>
                      )}
                    </div>
                    <p className="text-gray-800 line-clamp-2">
                      {firstQ.context_text || firstQ.content || "(image-based set)"}
                    </p>
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
                          <Link
                            href={`/dashboard/moderation/${q.id}?from_set=${setId}`}
                            className="btn-secondary text-sm"
                          >
                            Edit
                          </Link>
                          <button
                            type="button"
                            disabled={busy === q.id}
                            onClick={() => remove(q.id)}
                            className="btn-secondary text-sm text-red-700 border-red-200"
                          >
                            Delete
                          </button>
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
    </>
  );
}
