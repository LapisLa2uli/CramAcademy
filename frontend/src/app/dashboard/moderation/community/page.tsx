"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import type { Question } from "@/types";

export default function ModerationCommunityBankPage() {
  const { profile } = useAuth();
  const [items, setItems] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

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
      ) : items.length === 0 ? (
        <div className="card p-8 text-center text-gray-500">No published community questions.</div>
      ) : (
        <div className="space-y-4">
          {items.map((q) => (
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
          ))}
        </div>
      )}
    </>
  );
}
