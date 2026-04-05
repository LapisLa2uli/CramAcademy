"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import type { Question } from "@/types";

type ReasonOpt = { id: string; label: string };

export default function ModerationQueuePage() {
  const { profile } = useAuth();
  const [items, setItems] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [reasons, setReasons] = useState<ReasonOpt[]>([]);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState<string>("");
  const [rejectExplanation, setRejectExplanation] = useState<string>("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.questions.moderationQueue();
      setItems(data);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to load queue");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (profile?.role === "moderator" || profile?.role === "admin") {
      load();
      api.questions
        .rejectionReasons()
        .then(setReasons)
        .catch(() => setReasons([]));
    }
  }, [profile?.role, load]);

  const approve = async (id: string) => {
    setBusy(id);
    try {
      await api.questions.approve(id);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Approve failed");
    } finally {
      setBusy(null);
    }
  };

  const confirmReject = async () => {
    if (!rejectId || !rejectReason) return;
    if (rejectReason === "other" && !rejectExplanation.trim()) {
      alert("Please provide a detailed explanation for 'Other'.");
      return;
    }
    setBusy(rejectId);
    try {
      await api.questions.reject(rejectId, {
        reason: rejectReason,
        ...(rejectReason === "other" ? { explanation: rejectExplanation.trim() } : {}),
      });
      setRejectId(null);
      setRejectReason("");
      setRejectExplanation("");
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Reject failed");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Permanently delete this question?")) return;
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

  if (profile?.role !== "moderator" && profile?.role !== "admin") {
    return (
      <p className="text-gray-600">You need the moderator or admin role to access this page.</p>
    );
  }

  return (
    <>
      <p className="text-gray-600 mb-8">
        Review questions submitted for the community pool. Approve to publish (author earns contribution
        points), reject with a reason to return the question to the author&apos;s personal bank, or
        edit first.
      </p>

      {rejectId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
            <h2 className="text-lg font-semibold text-gray-900">Reject question</h2>
            <p className="text-sm text-gray-600">
              Choose a reason. The author will see this on their question in My bank.
            </p>
            <select
              value={rejectReason}
              onChange={(e) => {
                setRejectReason(e.target.value);
                if (e.target.value !== "other") setRejectExplanation("");
              }}
              className="input-field w-full"
            >
              <option value="">Select a reason…</option>
              {reasons.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
            {rejectReason === "other" && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Explain in detail <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={rejectExplanation}
                  onChange={(e) => setRejectExplanation(e.target.value)}
                  className="input-field w-full min-h-[80px]"
                  placeholder="Why is this question being rejected?"
                  maxLength={2000}
                />
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                className="btn-secondary text-sm"
                onClick={() => {
                  setRejectId(null);
                  setRejectReason("");
                  setRejectExplanation("");
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary text-sm"
                disabled={!rejectReason || busy === rejectId}
                onClick={() => confirmReject()}
              >
                Reject
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-gray-400">Loading…</p>
      ) : items.length === 0 ? (
        <div className="card p-8 text-center text-gray-500">No questions awaiting review.</div>
      ) : (
        <div className="space-y-4" data-tutorial="queue-list">
          {items.map((q, qi) => (
            <div
              key={q.id}
              className="card p-5 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap gap-2 text-xs text-gray-500 mb-1">
                  <span>{q.subject}</span>
                  <span>{q.type}</span>
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
                </div>
                <p className="text-gray-800 line-clamp-4">{q.content || "(image stem)"}</p>
              </div>
              <div className="flex flex-wrap gap-2 shrink-0">
                <Link href={`/dashboard/moderation/${q.id}`} className="btn-secondary text-sm">
                  Edit
                </Link>
                <button
                  type="button"
                  disabled={busy === q.id}
                  onClick={() => approve(q.id)}
                  className="btn-primary text-sm"
                  {...(qi === 0 ? { "data-tutorial": "approve-btn" } : {})}
                >
                  Approve
                </button>
                <button
                  type="button"
                  disabled={busy === q.id}
                  onClick={() => {
                    setRejectId(q.id);
                    setRejectReason("");
                  }}
                  className="btn-secondary text-sm"
                  {...(qi === 0 ? { "data-tutorial": "reject-btn" } : {})}
                >
                  Reject…
                </button>
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
    </>
  );
}
