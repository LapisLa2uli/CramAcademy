"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Subject } from "@/types";

interface SubjectPickerProps {
  subjectId: string;
  onSubjectChange: (subjectId: string, subjectName: string) => void;
  level: string;
  onLevelChange: (level: string) => void;
  /** If true, show a "Any subject" option. Used in test config. */
  allowAny?: boolean;
}

/**
 * Dropdown pair: subject selector + level selector.
 * Levels are loaded dynamically from the selected subject's levels list.
 */
export default function SubjectPicker({
  subjectId,
  onSubjectChange,
  level,
  onLevelChange,
  allowAny = false,
}: SubjectPickerProps) {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.subjects
      .list()
      .then(setSubjects)
      .catch(() => setSubjects([]))
      .finally(() => setLoading(false));
  }, []);

  const selected = subjects.find((s) => s.id === subjectId);
  const levels = selected?.levels ?? [];

  // If the selected subject changes and the current level isn't valid, clear it
  useEffect(() => {
    if (level && levels.length > 0 && !levels.includes(level)) {
      onLevelChange("");
    }
  }, [subjectId, level, levels, onLevelChange]);

  return (
    <>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
        {loading ? (
          <div className="input-field text-gray-400">Loading subjects…</div>
        ) : (
          <select
            value={subjectId}
            onChange={(e) => {
              const id = e.target.value;
              const s = subjects.find((s) => s.id === id);
              onSubjectChange(id, s?.name ?? "");
            }}
            className="input-field"
          >
            {allowAny && <option value="">Any subject</option>}
            {!allowAny && !subjectId && (
              <option value="">Select a subject…</option>
            )}
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
      </div>
      {levels.length > 0 && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Level <span className="text-gray-400">(optional)</span>
          </label>
          <select
            value={level}
            onChange={(e) => onLevelChange(e.target.value)}
            className="input-field"
          >
            <option value="">{allowAny ? "Any level" : "—"}</option>
            {levels.map((lvl) => (
              <option key={lvl} value={lvl}>
                {lvl}
              </option>
            ))}
          </select>
        </div>
      )}
    </>
  );
}

/**
 * Hook to fetch subjects list once. Can be used when you need the raw list
 * (e.g. to resolve a subject_id to a name for display).
 */
export function useSubjects() {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.subjects
      .list()
      .then(setSubjects)
      .catch(() => setSubjects([]))
      .finally(() => setLoading(false));
  }, []);

  const nameById = (id?: string | null): string => {
    if (!id) return "";
    return subjects.find((s) => s.id === id)?.name ?? "";
  };

  return { subjects, loading, nameById };
}
