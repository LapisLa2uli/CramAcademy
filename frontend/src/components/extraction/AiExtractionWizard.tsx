"use client";

import { useCallback, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type {
  ExtractionAnalyzeResponse,
  ExtractionCommitBody,
  ExtractionPage,
  ExtractionSetDraft,
} from "@/types";
import SubjectPicker from "@/components/SubjectPicker";
import ExtractionOverlayCanvas from "./ExtractionOverlayCanvas";

type Step = "upload" | "analyze" | "review" | "done";

async function pagePngToFile(page: ExtractionPage): Promise<File> {
  const raw = page.image_base64.trim();
  const url = raw.startsWith("data:") ? raw : `data:image/png;base64,${raw}`;
  const res = await fetch(url);
  const blob = await res.blob();
  return new File([blob], `page-${page.page_index + 1}.png`, {
    type: blob.type || "image/png",
  });
}

function defaultFrqRubric(answer: string) {
  const hint = answer.trim().slice(0, 800);
  return {
    criteria: [
      {
        name: "Response",
        expectations: hint
          ? `Full credit for a complete response consistent with: ${hint}`
          : "Full credit for a complete, correct response.",
        points: 1,
      },
    ],
    max_score: 1,
  };
}

export default function AiExtractionWizard() {
  const [step, setStep] = useState<Step>("upload");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<ExtractionAnalyzeResponse | null>(null);
  const [editableSets, setEditableSets] = useState<ExtractionSetDraft[]>([]);
  const [pageIdx, setPageIdx] = useState(0);

  const [subjectId, setSubjectId] = useState("");
  const [subjectName, setSubjectName] = useState("");
  const [courseLevel, setCourseLevel] = useState("");
  const [gradeLevel, setGradeLevel] = useState<number | "">("");
  const [tags, setTags] = useState("");
  const [analyzeProgress, setAnalyzeProgress] = useState<{
    completed: number;
    total: number;
  } | null>(null);
  const [highAccuracy, setHighAccuracy] = useState(false);
  const [twoStage, setTwoStage] = useState(false);
  const [regenBusy, setRegenBusy] = useState(false);
  const [pageRegenHint, setPageRegenHint] = useState<string | null>(null);

  const pages: ExtractionPage[] = data?.pages ?? [];
  const currentPage = pages[pageIdx] ?? null;

  const startAnalyze = async () => {
    if (files.length === 0) {
      setErr("Choose a PDF or one or more images.");
      return;
    }
    setErr(null);
    setBusy(true);
    setAnalyzeProgress(null);
    setStep("analyze");
    try {
      const res = await api.extraction.analyze(files, {
        max_pages: 24,
        dpi: 160,
        high_accuracy: highAccuracy,
        two_stage: twoStage,
        onProgress: (completed, total) => {
          setAnalyzeProgress({ completed, total });
        },
      });
      setData(res);
      setEditableSets(structuredClone(res.sets));
      setPageIdx(0);
      setPageRegenHint(null);
      setStep("review");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Analysis failed.");
      setStep("upload");
    } finally {
      setBusy(false);
      setAnalyzeProgress(null);
    }
  };

  const updateQuestion = useCallback(
    (setIndex: number, qi: number, patch: Partial<ExtractionSetDraft["questions"][0]>) => {
      setEditableSets((prev) => {
        const next = structuredClone(prev);
        const s = next.find((x) => x.set_index === setIndex);
        if (!s || !s.questions[qi]) return prev;
        s.questions[qi] = { ...s.questions[qi], ...patch };
        return next;
      });
    },
    []
  );

  const regenerateCurrentPage = useCallback(async () => {
    if (!currentPage || !data) return;
    setErr(null);
    setPageRegenHint(null);
    setRegenBusy(true);
    try {
      const f = await pagePngToFile(currentPage);
      const res = await api.extraction.reanalyzePage(f, {
        dpi: 160,
        high_accuracy: highAccuracy,
        two_stage: twoStage,
      });
      const newP = res.pages[0];
      if (!newP) {
        setErr("Re-analyze returned no page.");
        return;
      }
      const keepIdx = currentPage.page_index;
      setData((prev) => {
        if (!prev) return prev;
        const nextPages = [...prev.pages];
        nextPages[pageIdx] = { ...newP, page_index: keepIdx };
        const mergedWarn = [...new Set([...prev.warnings, ...res.warnings])];
        return { ...prev, pages: nextPages, warnings: mergedWarn };
      });
      if (pages.length === 1) {
        setEditableSets(structuredClone(res.sets));
      } else {
        setPageRegenHint(
          "Overlay for this page was refreshed. Detected question lists still reflect the full-document run; edit text manually or run analyze again on a single-page file to resync structure."
        );
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Re-analyze failed.");
    } finally {
      setRegenBusy(false);
    }
  }, [currentPage, data, highAccuracy, twoStage, pageIdx, pages.length]);

  const updateSetContext = useCallback((setIndex: number, context_text: string) => {
    setEditableSets((prev) => {
      const next = structuredClone(prev);
      const s = next.find((x) => x.set_index === setIndex);
      if (!s) return prev;
      s.context_text = context_text;
      return next;
    });
  }, []);

  const commitPayload = useMemo((): ExtractionCommitBody | null => {
    if (!subjectName.trim()) return null;
    return {
      subject: subjectName.trim(),
      ...(subjectId ? { subject_id: subjectId } : {}),
      ...(courseLevel ? { course_level: courseLevel } : {}),
      ...(gradeLevel !== "" ? { grade_level: Number(gradeLevel) } : {}),
      tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      sets: editableSets
        .filter((s) => s.questions.length > 0)
        .map((s) => ({
          context_text: s.context_text || "",
          questions: s.questions.map((q) => {
            let rubric = q.rubric ?? undefined;
            if (q.type === "frq" && !rubric) {
              rubric = defaultFrqRubric(q.answer);
            }
            const latex =
              (q.content || "").includes("$") ||
              (q.explanation || "").includes("$") ||
              (q.options || []).some((o) => o.text.includes("$"));
            return {
              type: q.type,
              content: q.content,
              options: q.type === "mcq" ? q.options : undefined,
              answer: q.answer,
              explanation: q.explanation || undefined,
              rubric,
              latex_enabled: latex,
            };
          }),
        })),
    };
  }, [subjectName, subjectId, courseLevel, gradeLevel, tags, editableSets]);

  const doCommit = async () => {
    if (!commitPayload || commitPayload.sets.length === 0) {
      setErr("Select a subject and ensure at least one question set has questions.");
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      await api.extraction.commit(commitPayload);
      setStep("done");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Commit failed.");
    } finally {
      setBusy(false);
    }
  };

  if (step === "done") {
    return (
      <div className="card p-8 max-w-xl space-y-4">
        <h2 className="text-xl font-semibold text-gray-900">Saved to your bank</h2>
        <p className="text-gray-600 text-sm">
          Question sets and questions were added to your personal bank. You can review them under{" "}
          <strong>My question bank</strong>.
        </p>
        <button type="button" className="btn-primary" onClick={() => {
          setStep("upload");
          setFiles([]);
          setData(null);
          setEditableSets([]);
          setErr(null);
        }}>
          Extract another document
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">AI extract (PDF or images)</h2>
        <p className="text-sm text-gray-600 mt-1">
          Upload one PDF or several page images. The model proposes regions and question structure; review before saving.
        </p>
      </div>

      {step === "upload" && (
        <div className="card p-6 space-y-4">
          <input
            type="file"
            multiple
            accept="application/pdf,image/jpeg,image/png,image/webp,image/gif"
            className="text-sm text-gray-700"
            onChange={(e) => setFiles(Array.from(e.target.files || []))}
          />
          <div className="space-y-2 text-sm text-gray-700">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="mt-1 rounded border-gray-300"
                checked={highAccuracy}
                onChange={(e) => setHighAccuracy(e.target.checked)}
              />
              <span>
                <span className="font-medium text-gray-900">High accuracy</span>
                <span className="block text-gray-600 text-xs mt-0.5">
                  Higher render DPI and longer image edge (slower, more cost). Recommended for dense or small print.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="mt-1 rounded border-gray-300"
                checked={twoStage}
                onChange={(e) => setTwoStage(e.target.checked)}
              />
              <span>
                <span className="font-medium text-gray-900">Two-stage extraction</span>
                <span className="block text-gray-600 text-xs mt-0.5">
                  Layout pass then structure (extra latency; can improve boxes on busy pages).
                </span>
              </span>
            </label>
          </div>
          <button
            type="button"
            className="btn-primary"
            disabled={busy || files.length === 0}
            onClick={() => void startAnalyze()}
          >
            {busy ? "Working…" : "Analyze"}
          </button>
        </div>
      )}

      {step === "analyze" && (
        <div className="card p-8 space-y-4 max-w-lg">
          <p className="text-gray-800 font-medium">Analyzing pages…</p>
          <p className="text-sm text-gray-500">
            Vision model runs in parallel (with a concurrency cap). Progress updates as each page finishes.
          </p>
          {analyzeProgress != null && analyzeProgress.total > 0 ? (
            <>
              <div
                className="h-3 bg-gray-200 rounded-full overflow-hidden"
                role="progressbar"
                aria-valuenow={analyzeProgress.completed}
                aria-valuemin={0}
                aria-valuemax={analyzeProgress.total}
                aria-label="Pages analyzed"
              >
                <div
                  className="h-full bg-primary-600 transition-[width] duration-300 ease-out rounded-full"
                  style={{
                    width: `${Math.min(100, (analyzeProgress.completed / analyzeProgress.total) * 100)}%`,
                  }}
                />
              </div>
              <p className="text-sm text-gray-700 tabular-nums">
                <span className="font-semibold text-gray-900">{analyzeProgress.completed}</span>
                {" / "}
                <span>{analyzeProgress.total}</span> pages analyzed
              </p>
            </>
          ) : (
            <p className="text-sm text-gray-500">Preparing pages…</p>
          )}
        </div>
      )}

      {step === "review" && data && (
        <>
          {data.warnings.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <p className="font-medium mb-1">Consistency checks</p>
              <ul className="list-disc pl-5 space-y-0.5">
                {data.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid lg:grid-cols-2 gap-6">
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2 items-center">
                <span className="text-sm font-medium text-gray-700">Page</span>
                <select
                  className="input-field text-sm py-1 max-w-[120px]"
                  value={pageIdx}
                  onChange={(e) => setPageIdx(Number(e.target.value))}
                >
                  {pages.map((p, i) => (
                    <option key={p.page_index} value={i}>
                      {i + 1} / {pages.length}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="text-sm px-3 py-1 rounded-md border border-gray-300 text-gray-800 hover:bg-gray-50 disabled:opacity-50"
                  disabled={regenBusy || !currentPage}
                  onClick={() => void regenerateCurrentPage()}
                >
                  {regenBusy ? "Re-running…" : "Re-run vision on this page"}
                </button>
              </div>
              {pageRegenHint && (
                <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-md px-3 py-2">
                  {pageRegenHint}
                </p>
              )}
              {currentPage ? (
                <ExtractionOverlayCanvas
                  imageBase64={currentPage.image_base64}
                  regions={currentPage.regions}
                />
              ) : (
                <p className="text-gray-500 text-sm">No page bitmaps returned.</p>
              )}
            </div>

            <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
              <h3 className="font-medium text-gray-800">Detected sets</h3>
              {editableSets.length === 0 ? (
                <p className="text-sm text-gray-500">No structured sets — try another document.</p>
              ) : (
                editableSets.map((s) => (
                  <div
                    key={s.set_index}
                    className="card p-4 space-y-3 border border-gray-200"
                  >
                    <p className="text-xs font-semibold text-purple-700">Set {s.set_index}</p>
                    <label className="block text-xs text-gray-600">Context / passage</label>
                    <textarea
                      className="input-field text-sm min-h-[80px]"
                      value={s.context_text}
                      onChange={(e) => updateSetContext(s.set_index, e.target.value)}
                    />
                    {s.shared_stems.length > 0 && (
                      <div className="text-xs text-gray-500">
                        Shared stems (applied in model output to questions):{" "}
                        {s.shared_stems.map((ss, j) => (
                          <span key={j} className="block mt-1">
                            Q{ss.applies_to_question_numbers.join(",")}: {ss.text.slice(0, 120)}
                            {ss.text.length > 120 ? "…" : ""}
                          </span>
                        ))}
                      </div>
                    )}
                    {s.questions.map((q, qi) => (
                      <div
                        key={`${s.set_index}-${q.question_index}`}
                        className="border-t border-gray-100 pt-3 space-y-2"
                      >
                        <p className="text-xs font-medium text-gray-600">
                          Q{q.question_index} · {q.type.toUpperCase()}
                        </p>
                        <textarea
                          className="input-field text-sm min-h-[72px]"
                          placeholder="Stem"
                          value={q.content}
                          onChange={(e) =>
                            updateQuestion(s.set_index, qi, { content: e.target.value })
                          }
                        />
                        {q.type === "mcq" && (
                          <div className="space-y-1">
                            {(q.options || []).map((o, oi) => (
                              <div key={o.label} className="flex gap-2 items-center">
                                <span className="text-xs w-6 text-gray-500">{o.label}</span>
                                <input
                                  className="input-field text-sm flex-1"
                                  value={o.text}
                                  onChange={(e) => {
                                    const opts = [...(q.options || [])];
                                    opts[oi] = { ...opts[oi], text: e.target.value };
                                    updateQuestion(s.set_index, qi, { options: opts });
                                  }}
                                />
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-xs text-gray-500">Answer</label>
                            <input
                              className="input-field text-sm"
                              value={q.answer}
                              onChange={(e) =>
                                updateQuestion(s.set_index, qi, { answer: e.target.value })
                              }
                            />
                          </div>
                          {q.type === "mcq" && (
                            <div>
                              <label className="text-xs text-gray-500">Explanation</label>
                              <input
                                className="input-field text-sm"
                                value={q.explanation || ""}
                                onChange={(e) =>
                                  updateQuestion(s.set_index, qi, {
                                    explanation: e.target.value,
                                  })
                                }
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ))
              )}

              <div className="card p-4 space-y-3 border-2 border-primary-100">
                <h3 className="font-medium text-gray-800">Subject &amp; save</h3>
                <SubjectPicker
                  subjectId={subjectId}
                  onSubjectChange={(id, name) => {
                    setSubjectId(id);
                    setSubjectName(name);
                  }}
                  level={courseLevel}
                  onLevelChange={setCourseLevel}
                  allowAny={false}
                />
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Grade (optional)</label>
                  <select
                    className="input-field text-sm"
                    value={gradeLevel}
                    onChange={(e) =>
                      setGradeLevel(e.target.value === "" ? "" : Number(e.target.value))
                    }
                  >
                    <option value="">—</option>
                    {[6, 7, 8, 9, 10, 11, 12].map((g) => (
                      <option key={g} value={g}>
                        Grade {g}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Tags (comma-separated)</label>
                  <input
                    className="input-field text-sm"
                    value={tags}
                    onChange={(e) => setTags(e.target.value)}
                  />
                </div>
                <p className="text-xs text-gray-500">
                  Free-response items without an AI rubric get a simple default rubric; edit the model answer above so expectations stay accurate.
                </p>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={busy || !subjectName.trim()}
                  onClick={() => void doCommit()}
                >
                  {busy ? "Saving…" : "Commit to my bank"}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {err && (
        <div className="rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm px-4 py-2">
          {err}
        </div>
      )}
    </div>
  );
}
