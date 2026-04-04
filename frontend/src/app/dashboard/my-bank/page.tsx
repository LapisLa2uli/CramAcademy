"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Question } from "@/types";

function poolLabel(pool?: string) {
  if (pool === "community_pending") return "Awaiting review";
  if (pool === "community") return "Published";
  return "Personal";
}

export default function MyBankPage() {
  const [items, setItems] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

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

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 mb-2">My question bank</h1>
      <p className="text-gray-600 mb-8 max-w-2xl">
        Questions you create start here. Submit a personal question to the moderation queue when
        you want it considered for the shared community pool.
      </p>

      {loading ? (
        <p className="text-gray-400">Loading…</p>
      ) : items.length === 0 ? (
        <div className="card p-8 text-center text-gray-500">
          No questions yet. Add some from the Contribute tab on the dashboard.
        </div>
      ) : (
        <div className="space-y-4">
          {items.map((q) => (
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
}
