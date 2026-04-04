"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import type { Subject } from "@/types";

export default function AdminSubjectsPage() {
  const { profile } = useAuth();
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // New subject form
  const [newName, setNewName] = useState("");
  const [newLevels, setNewLevels] = useState("");

  // Edit state
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editLevels, setEditLevels] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.subjects.list();
      setSubjects(data);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to load subjects");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (profile?.role === "admin") load();
  }, [profile?.role, load]);

  const addSubject = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const levels = newLevels
        .split(",")
        .map((l) => l.trim())
        .filter(Boolean);
      await api.subjects.create({
        name,
        levels,
        position: subjects.length,
      });
      setNewName("");
      setNewLevels("");
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to create subject");
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (s: Subject) => {
    setEditId(s.id);
    setEditName(s.name);
    setEditLevels(s.levels.join(", "));
  };

  const cancelEdit = () => {
    setEditId(null);
    setEditName("");
    setEditLevels("");
  };

  const saveEdit = async () => {
    if (!editId) return;
    setBusy(true);
    try {
      const levels = editLevels
        .split(",")
        .map((l) => l.trim())
        .filter(Boolean);
      await api.subjects.update(editId, {
        name: editName.trim(),
        levels,
      });
      cancelEdit();
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to update subject");
    } finally {
      setBusy(false);
    }
  };

  const deleteSubject = async (id: string, name: string) => {
    if (
      !confirm(
        `Delete "${name}"? Questions assigned to this subject will lose their subject classification and need to be re-assigned.`
      )
    )
      return;
    setBusy(true);
    try {
      await api.subjects.delete(id);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to delete subject");
    } finally {
      setBusy(false);
    }
  };

  const moveSubject = async (id: string, direction: -1 | 1) => {
    const idx = subjects.findIndex((s) => s.id === id);
    if (idx < 0) return;
    const swapIdx = idx + direction;
    if (swapIdx < 0 || swapIdx >= subjects.length) return;
    setBusy(true);
    try {
      const a = subjects[idx];
      const b = subjects[swapIdx];
      await Promise.all([
        api.subjects.update(a.id, { position: b.position }),
        api.subjects.update(b.id, { position: a.position }),
      ]);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to reorder");
    } finally {
      setBusy(false);
    }
  };

  if (profile?.role !== "admin") {
    return (
      <div>
        <h1 className="text-3xl font-bold text-gray-900 mb-4">Subjects</h1>
        <p className="text-gray-600">You need the admin role to manage subjects.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-4 mb-2">
        <h1 className="text-3xl font-bold text-gray-900">Subjects &amp; Levels</h1>
      </div>
      <p className="text-gray-600 mb-4">
        <Link href="/dashboard/admin" className="text-primary-700 hover:underline">
          ← User administration
        </Link>
      </p>
      <p className="text-gray-600 mb-8 max-w-2xl">
        Manage the global list of subjects. Each subject can define its own set of levels
        (e.g. S, S+, H, H+). When users create questions they must pick a subject from
        this list. Deleting a subject removes the classification from all linked questions.
      </p>

      {/* Add new subject */}
      <form
        onSubmit={addSubject}
        className="card p-6 mb-8 space-y-4 max-w-xl"
      >
        <h2 className="text-lg font-semibold text-gray-800">Add Subject</h2>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Subject name
          </label>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="input-field"
            placeholder="e.g. AP World History"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Levels <span className="text-gray-400">(comma-separated, optional)</span>
          </label>
          <input
            value={newLevels}
            onChange={(e) => setNewLevels(e.target.value)}
            className="input-field"
            placeholder="e.g. S, S+, H, H+"
          />
          <p className="text-xs text-gray-500 mt-1">
            Leave blank if this subject has no levels. Users will see these as options when
            creating questions.
          </p>
        </div>
        <button type="submit" disabled={busy} className="btn-primary">
          {busy ? "Adding…" : "Add Subject"}
        </button>
      </form>

      {/* Subjects list */}
      {loading ? (
        <p className="text-gray-400">Loading…</p>
      ) : subjects.length === 0 ? (
        <div className="card p-8 text-center text-gray-500">
          No subjects defined yet. Add one above.
        </div>
      ) : (
        <div className="space-y-3">
          {subjects.map((s, idx) => (
            <div
              key={s.id}
              className="card p-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
            >
              {editId === s.id ? (
                /* Edit mode */
                <div className="flex-1 space-y-3">
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="input-field"
                    placeholder="Subject name"
                  />
                  <input
                    value={editLevels}
                    onChange={(e) => setEditLevels(e.target.value)}
                    className="input-field"
                    placeholder="Levels (comma-separated)"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={saveEdit}
                      className="btn-primary text-sm"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={cancelEdit}
                      className="btn-secondary text-sm"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                /* View mode */
                <>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-gray-800">{s.name}</span>
                      <span className="text-xs text-gray-400">#{idx + 1}</span>
                    </div>
                    {s.levels.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {s.levels.map((lvl) => (
                          <span
                            key={lvl}
                            className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 font-medium"
                          >
                            {lvl}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400">No levels defined</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={busy || idx === 0}
                      onClick={() => moveSubject(s.id, -1)}
                      className="btn-secondary text-sm px-2"
                      title="Move up"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      disabled={busy || idx === subjects.length - 1}
                      onClick={() => moveSubject(s.id, 1)}
                      className="btn-secondary text-sm px-2"
                      title="Move down"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => startEdit(s)}
                      className="btn-secondary text-sm"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => deleteSubject(s.id, s.name)}
                      className="btn-secondary text-sm text-red-700 border-red-200"
                    >
                      Delete
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
