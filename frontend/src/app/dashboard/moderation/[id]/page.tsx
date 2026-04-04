"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import SubjectPicker from "@/components/SubjectPicker";
import type { Difficulty, Question, QuestionType } from "@/types";

export default function ModerationEditPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const id = params.id;
  const fromSet = searchParams.get("from_set");
  const { profile } = useAuth();
  const [q, setQ] = useState<Question | null>(null);
  const [subjectId, setSubjectId] = useState("");
  const [subjectName, setSubjectName] = useState("");
  const [courseLevel, setCourseLevel] = useState("");
  const [content, setContent] = useState("");
  const [answer, setAnswer] = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [type, setType] = useState<QuestionType>("mcq");
  const [explanation, setExplanation] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const data = await api.questions.get(id);
      setQ(data);
      setSubjectId(data.subject_id || "");
      setSubjectName(data.subject || "");
      setCourseLevel(data.course_level || "");
      setContent(data.content);
      setAnswer(data.answer || "");
      setDifficulty(data.difficulty);
      setType(data.type);
      setExplanation(data.explanation || "");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Load failed");
      setQ(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;
    setSaving(true);
    try {
      await api.questions.update(id, {
        subject: subjectName,
        subject_id: subjectId || undefined,
        course_level: courseLevel || undefined,
        content,
        answer,
        difficulty,
        type,
        explanation: explanation.trim() || undefined,
      });
      await load();
      alert("Saved.");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (profile?.role !== "moderator" && profile?.role !== "admin") {
    return (
      <p className="text-gray-600">
        <Link href="/dashboard/moderation/queue" className="text-primary-700">
          Back
        </Link>{" "}
        — moderator access required.
      </p>
    );
  }

  if (loading) {
    return <p className="text-gray-400">Loading…</p>;
  }

  if (!q) {
    return (
      <p>
        <Link href="/dashboard/moderation/queue" className="text-primary-700">
          Back to queue
        </Link>
      </p>
    );
  }

  return (
    <div className="max-w-2xl">
      {fromSet ? (
        <Link href="/dashboard/moderation/community" className="text-sm text-purple-700 mb-4 inline-block">
          ← Back to question set
        </Link>
      ) : (
        <Link href="/dashboard/moderation/queue" className="text-sm text-primary-700 mb-4 inline-block">
          ← Moderation queue
        </Link>
      )}
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Edit question</h1>
      <form onSubmit={save} className="card p-8 space-y-4">
        <SubjectPicker
          subjectId={subjectId}
          onSubjectChange={(id, name) => { setSubjectId(id); setSubjectName(name); }}
          level={courseLevel}
          onLevelChange={setCourseLevel}
          allowAny={false}
        />
        {!subjectId && q?.subject && (
          <p className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1">
            Old subject value: &ldquo;{q.subject}&rdquo; — please re-assign using the dropdown above.
          </p>
        )}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as QuestionType)}
              className="input-field"
            >
              <option value="mcq">MCQ</option>
              <option value="frq">FRQ</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Difficulty</label>
            <select
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value as Difficulty)}
              className="input-field"
            >
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Content</label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="input-field min-h-[160px]"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Answer</label>
          <input value={answer} onChange={(e) => setAnswer(e.target.value)} className="input-field" />
        </div>
        {type === "mcq" && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Explanation <span className="text-gray-400">(optional; LaTeX: $...$)</span>
            </label>
            <textarea
              value={explanation}
              onChange={(e) => setExplanation(e.target.value)}
              className="input-field min-h-[80px]"
              placeholder="Why is this the correct answer?"
            />
          </div>
        )}
        <p className="text-xs text-gray-500">
          MCQ options and rubrics are not edited on this screen; use API or Supabase for complex
          changes if needed.
        </p>
        <button type="submit" disabled={saving} className="btn-primary">
          {saving ? "Saving…" : "Save changes"}
        </button>
      </form>
    </div>
  );
}
