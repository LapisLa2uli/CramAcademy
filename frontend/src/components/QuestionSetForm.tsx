"use client";

import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { uploadQuestionImage } from "@/lib/questionImageUpload";
import RubricTableEditor, {
  defaultRubricRows,
  buildRubricFromRows,
  type RubricRow,
} from "./RubricTableEditor";
import LatexHoverPreview from "./LatexHoverPreview";
import type { CourseLevel } from "@/types";

type OptionRow = {
  label: string;
  text: string;
  file: File | null;
  preview: string | null;
};

function freshOptions(): OptionRow[] {
  return ["A", "B", "C", "D"].map((label) => ({
    label,
    text: "",
    file: null,
    preview: null,
  }));
}

interface StemQuestion {
  type: "mcq" | "frq";
  content: string;
  stemFile: File | null;
  stemPreview: string | null;
  options: OptionRow[];
  answer: string;
  explanation: string;
  explanationFile: File | null;
  explanationPreview: string | null;
  rubricRows: RubricRow[];
}

function freshStemQuestion(): StemQuestion {
  return {
    type: "mcq",
    content: "",
    stemFile: null,
    stemPreview: null,
    options: freshOptions(),
    answer: "",
    explanation: "",
    explanationFile: null,
    explanationPreview: null,
    rubricRows: defaultRubricRows(),
  };
}

export default function QuestionSetForm() {
  const { user } = useAuth();
  const previewUrlsRef = useRef<string[]>([]);

  const trackPreview = (url: string | null) => {
    if (url) previewUrlsRef.current.push(url);
  };

  // Shared context
  const [contextText, setContextText] = useState("");
  const [contextImageFile, setContextImageFile] = useState<File | null>(null);
  const [contextImagePreview, setContextImagePreview] = useState<string | null>(null);

  // Shared metadata
  const [subject, setSubject] = useState("Mathematics");
  const [difficulty, setDifficulty] = useState<"easy" | "medium" | "hard">("medium");
  const [courseLevel, setCourseLevel] = useState<CourseLevel | "">("");
  const [gradeLevel, setGradeLevel] = useState<number | "">("");
  const [tags, setTags] = useState("");

  // Questions in the set
  const [questions, setQuestions] = useState<StemQuestion[]>([freshStemQuestion()]);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    return () => {
      previewUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
    };
  }, []);

  const setContextImage = (file: File | null) => {
    if (contextImagePreview) {
      URL.revokeObjectURL(contextImagePreview);
    }
    setContextImageFile(file);
    if (file) {
      const url = URL.createObjectURL(file);
      trackPreview(url);
      setContextImagePreview(url);
    } else {
      setContextImagePreview(null);
    }
  };

  const updateQuestion = (index: number, patch: Partial<StemQuestion>) => {
    setQuestions((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  };

  const setOptionFile = (qIndex: number, optIndex: number, file: File | null) => {
    setQuestions((prev) => {
      const next = [...prev];
      const q = { ...next[qIndex] };
      const opts = [...q.options];
      const row = opts[optIndex];
      if (row.preview) URL.revokeObjectURL(row.preview);
      if (file) {
        const url = URL.createObjectURL(file);
        previewUrlsRef.current.push(url);
        opts[optIndex] = { ...row, file, preview: url };
      } else {
        opts[optIndex] = { ...row, file: null, preview: null };
      }
      q.options = opts;
      next[qIndex] = q;
      return next;
    });
  };

  const addQuestion = () => {
    setQuestions((prev) => [...prev, freshStemQuestion()]);
  };

  const removeQuestion = (index: number) => {
    if (questions.length <= 1) return;
    const q = questions[index];
    if (q.stemPreview) URL.revokeObjectURL(q.stemPreview);
    if (q.explanationPreview) URL.revokeObjectURL(q.explanationPreview);
    q.options.forEach((o) => { if (o.preview) URL.revokeObjectURL(o.preview); });
    setQuestions((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.id) {
      alert("You must be signed in.");
      return;
    }
    if (!contextText.trim() && !contextImageFile) {
      alert("Add context text and/or a context image for the question set.");
      return;
    }
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q.content.trim() && !q.stemFile) {
        alert(`Question ${i + 1}: Add question text and/or an image.`);
        return;
      }
      if (q.type === "mcq") {
        for (const o of q.options) {
          if (!o.text.trim() && !o.file) {
            alert(`Question ${i + 1}, Option ${o.label}: Needs text and/or an image.`);
            return;
          }
        }
        const L = q.answer.trim().toUpperCase();
        if (!["A", "B", "C", "D"].includes(L)) {
          alert(`Question ${i + 1}: Enter a correct choice letter (A-D).`);
          return;
        }
      }
      if (q.type === "frq") {
        const rubric = buildRubricFromRows(q.rubricRows);
        if (!rubric) {
          alert(`Question ${i + 1}: Add at least one rubric row with name, expectations, and points > 0.`);
          return;
        }
        if (!q.answer.trim()) {
          alert(`Question ${i + 1}: Type the model answer.`);
          return;
        }
      }
    }

    setLoading(true);
    setSuccess(false);

    try {
      // Upload context image if present
      let context_image_url: string | undefined;
      if (contextImageFile) {
        context_image_url = await uploadQuestionImage(user.id, contextImageFile);
      }

      // Create the question set
      const set = await api.questionSets.create({
        context_text: contextText.trim(),
        ...(context_image_url ? { context_image_url } : {}),
      });

      // Create each question in the set
      for (const q of questions) {
        let question_image_url: string | undefined;
        if (q.stemFile) {
          question_image_url = await uploadQuestionImage(user.id, q.stemFile);
        }

        let explanation_image_url: string | undefined;
        if (q.explanationFile) {
          explanation_image_url = await uploadQuestionImage(user.id, q.explanationFile);
        }

        let mcqPayload: { label: string; text: string; image_url?: string }[] | undefined;
        if (q.type === "mcq") {
          mcqPayload = await Promise.all(
            q.options.map(async (o) => {
              let image_url: string | undefined;
              if (o.file) {
                image_url = await uploadQuestionImage(user.id, o.file);
              }
              return {
                label: o.label,
                text: o.text.trim(),
                ...(image_url ? { image_url } : {}),
              };
            })
          );
        }

        let rubricObj: Record<string, unknown> | undefined;
        if (q.type === "frq") {
          rubricObj = buildRubricFromRows(q.rubricRows) ?? undefined;
        }

        await api.questionSets.addQuestion(set.id, {
          type: q.type,
          subject,
          difficulty,
          ...(courseLevel ? { course_level: courseLevel } : {}),
          ...(gradeLevel !== "" ? { grade_level: Number(gradeLevel) } : {}),
          content: q.content.trim(),
          ...(question_image_url ? { question_image_url } : {}),
          answer: q.type === "mcq" ? q.answer.trim().toUpperCase().slice(0, 1) : q.answer.trim(),
          ...(q.explanation.trim() ? { explanation: q.explanation.trim() } : {}),
          ...(explanation_image_url ? { explanation_image_url } : {}),
          tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
          latex_enabled:
            q.content.includes("$") ||
            q.explanation.includes("$") ||
            contextText.includes("$"),
          options: mcqPayload,
          rubric: rubricObj,
        });
      }

      setSuccess(true);
      setContextText("");
      if (contextImagePreview) URL.revokeObjectURL(contextImagePreview);
      setContextImageFile(null);
      setContextImagePreview(null);
      setQuestions([freshStemQuestion()]);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to submit question set");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="card p-8 space-y-6 max-w-3xl">
      <h2 className="text-xl font-semibold text-gray-800">Create a Question Set</h2>
      <p className="text-sm text-gray-500">
        A question set shares a common context (passage, image, scenario) with multiple
        stemming questions &mdash; like AP Lang MCQ sets. Enter the shared context first,
        then add each question below.
      </p>

      {/* Shared Context */}
      <div className="space-y-3 p-4 bg-purple-50 border border-purple-200 rounded-lg">
        <h3 className="font-medium text-purple-800">Shared Context</h3>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Context / Passage text <span className="text-gray-400">(LaTeX: $...$)</span>
          </label>
          <LatexHoverPreview value={contextText}>
            <textarea
              value={contextText}
              onChange={(e) => setContextText(e.target.value)}
              className="input-field min-h-[160px]"
              placeholder="Enter the shared passage, scenario, or context that all questions reference..."
            />
          </LatexHoverPreview>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Context image <span className="text-gray-400">(optional)</span>
          </label>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="text-sm text-gray-600"
            onChange={(e) => setContextImage(e.target.files?.[0] ?? null)}
          />
          {contextImagePreview && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={contextImagePreview}
              alt="Context preview"
              className="mt-2 max-h-48 rounded border border-gray-200 object-contain"
            />
          )}
        </div>
      </div>

      {/* Shared Metadata */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="input-field"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Difficulty</label>
          <select
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value as "easy" | "medium" | "hard")}
            className="input-field"
          >
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Course level <span className="text-gray-400">(opt.)</span>
          </label>
          <select
            value={courseLevel}
            onChange={(e) => setCourseLevel(e.target.value as CourseLevel | "")}
            className="input-field"
          >
            <option value="">--</option>
            <option value="S">S (Standard)</option>
            <option value="S+">S+ (Standard+)</option>
            <option value="H">H (Honors)</option>
            <option value="H+">H+ (Honors+)</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Grade <span className="text-gray-400">(opt.)</span>
          </label>
          <select
            value={gradeLevel}
            onChange={(e) =>
              setGradeLevel(e.target.value === "" ? "" : Number(e.target.value))
            }
            className="input-field"
          >
            <option value="">--</option>
            {[6, 7, 8, 9, 10, 11, 12].map((g) => (
              <option key={g} value={g}>Grade {g}</option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Tags <span className="text-gray-400">(comma-separated)</span>
          </label>
          <input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            className="input-field"
            placeholder="algebra, passage-analysis"
          />
        </div>
      </div>

      {/* Questions */}
      <div className="space-y-6">
        <h3 className="font-medium text-gray-800">
          Questions ({questions.length})
        </h3>
        {questions.map((q, qi) => (
          <div
            key={qi}
            className="border border-gray-200 rounded-lg p-4 space-y-4 bg-white"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-700">
                Question {qi + 1}
              </span>
              <div className="flex items-center gap-3">
                <select
                  value={q.type}
                  onChange={(e) =>
                    updateQuestion(qi, {
                      type: e.target.value as "mcq" | "frq",
                      options: freshOptions(),
                      answer: "",
                      rubricRows: defaultRubricRows(),
                    })
                  }
                  className="input-field text-sm py-1 w-auto"
                >
                  <option value="mcq">MCQ</option>
                  <option value="frq">FRQ</option>
                </select>
                {questions.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeQuestion(qi)}
                    className="text-red-500 hover:text-red-700 text-sm"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>

            <div>
              <label className="block text-sm text-gray-600 mb-1">
                Question text <span className="text-gray-400">(LaTeX: $...$)</span>
              </label>
              <LatexHoverPreview value={q.content}>
                <textarea
                  value={q.content}
                  onChange={(e) => updateQuestion(qi, { content: e.target.value })}
                  className="input-field min-h-[80px]"
                  placeholder="Question stem..."
                />
              </LatexHoverPreview>
            </div>

            <div>
              <label className="block text-sm text-gray-600 mb-1">
                Question image <span className="text-gray-400">(optional)</span>
              </label>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="text-xs text-gray-600"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  if (q.stemPreview) URL.revokeObjectURL(q.stemPreview);
                  let preview: string | null = null;
                  if (f) {
                    preview = URL.createObjectURL(f);
                    previewUrlsRef.current.push(preview);
                  }
                  updateQuestion(qi, { stemFile: f, stemPreview: preview });
                }}
              />
              {q.stemPreview && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={q.stemPreview}
                  alt="Preview"
                  className="mt-2 max-h-32 rounded border border-gray-200 object-contain"
                />
              )}
            </div>

            {q.type === "mcq" && (
              <div className="space-y-2">
                <label className="block text-sm text-gray-600">Options</label>
                {q.options.map((opt, oi) => (
                  <div
                    key={opt.label}
                    className="rounded-lg border border-gray-200 p-2 space-y-1 bg-gray-50/50"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-500 w-6 text-sm">
                        {opt.label}.
                      </span>
                      <LatexHoverPreview value={opt.text}>
                        <input
                          value={opt.text}
                          onChange={(e) => {
                            const opts = [...q.options];
                            opts[oi] = { ...opt, text: e.target.value };
                            updateQuestion(qi, { options: opts });
                          }}
                          className="input-field flex-1 text-sm"
                          placeholder={`Option ${opt.label} text`}
                        />
                      </LatexHoverPreview>
                    </div>
                    <div className="ml-8">
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/gif"
                        className="text-xs text-gray-600"
                        onChange={(e) =>
                          setOptionFile(qi, oi, e.target.files?.[0] ?? null)
                        }
                      />
                      {opt.preview && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={opt.preview}
                          alt={`Preview ${opt.label}`}
                          className="mt-1 max-h-20 rounded border border-gray-200 object-contain"
                        />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {q.type === "frq" && (
              <RubricTableEditor
                rows={q.rubricRows}
                onChange={(rows) => updateQuestion(qi, { rubricRows: rows })}
              />
            )}

            <div>
              <label className="block text-sm text-gray-600 mb-1">
                Correct Answer {q.type === "mcq" ? "(letter)" : ""}
              </label>
              <LatexHoverPreview value={q.answer}>
                <input
                  value={q.answer}
                  onChange={(e) => updateQuestion(qi, { answer: e.target.value })}
                  className="input-field"
                  placeholder={q.type === "mcq" ? "A" : "Model answer or solution"}
                />
              </LatexHoverPreview>
            </div>

            {q.type === "mcq" && (
              <div className="space-y-2">
                <label className="block text-sm text-gray-600">
                  Explanation <span className="text-gray-400">(optional)</span>
                </label>
                <LatexHoverPreview value={q.explanation}>
                  <textarea
                    value={q.explanation}
                    onChange={(e) =>
                      updateQuestion(qi, { explanation: e.target.value })
                    }
                    className="input-field min-h-[60px]"
                    placeholder="Why is this the correct answer?"
                  />
                </LatexHoverPreview>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">
                    Explanation image <span className="text-gray-400">(optional)</span>
                  </label>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    className="text-xs text-gray-600"
                    onChange={(e) => {
                      const f = e.target.files?.[0] ?? null;
                      if (q.explanationPreview) URL.revokeObjectURL(q.explanationPreview);
                      let preview: string | null = null;
                      if (f) {
                        preview = URL.createObjectURL(f);
                        previewUrlsRef.current.push(preview);
                      }
                      updateQuestion(qi, { explanationFile: f, explanationPreview: preview });
                    }}
                  />
                  {q.explanationPreview && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={q.explanationPreview}
                      alt="Explanation preview"
                      className="mt-1 max-h-20 rounded border border-gray-200 object-contain"
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        ))}

        <button
          type="button"
          onClick={addQuestion}
          className="btn-secondary w-full"
        >
          + Add another question
        </button>
      </div>

      {success && (
        <p className="text-sm text-green-600 bg-green-50 rounded-lg p-3">
          Question set saved to your personal bank ({questions.length} question{questions.length !== 1 ? "s" : ""}).
          Open <strong>My question bank</strong> to submit them for community review.
        </p>
      )}

      <button type="submit" disabled={loading} className="btn-primary w-full">
        {loading
          ? "Uploading & submitting..."
          : `Submit Question Set (${questions.length} question${questions.length !== 1 ? "s" : ""})`}
      </button>
    </form>
  );
}
