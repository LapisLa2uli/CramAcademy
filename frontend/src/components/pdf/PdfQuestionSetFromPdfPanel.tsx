"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { api } from "@/lib/api";
import { uploadQuestionImage } from "@/lib/questionImageUpload";
import { cropPdfRegionToPng, type NormRect } from "@/lib/pdf/cropPdfPage";
import { cropImageRegionToPng } from "@/lib/cropImageRegion";
import PdfRegionWorkspace, {
  type RegionMode,
  MODE_LABELS,
  REGION_COLORS,
} from "./PdfRegionWorkspace";
import ImageRegionWorkspace from "./ImageRegionWorkspace";
import PageThumbnailStrip from "./PageThumbnailStrip";
import RubricTableEditor, {
  type RubricRow,
  defaultRubricRows,
  buildRubricFromRows,
} from "../RubricTableEditor";
import LatexHoverPreview from "../LatexHoverPreview";
import SubjectPicker from "../SubjectPicker";

const CROP_SCALE = 2.5;

type QueuedQuestion = {
  type: "mcq" | "frq";
  question_image_url: string;
  options?: { label: string; text: string; image_url?: string }[];
  answer: string;
  explanation?: string;
  explanation_image_url?: string;
  rubric?: Record<string, unknown>;
  content: string;
};

type PageRects = Record<number, Partial<Record<RegionMode, NormRect>>>;

interface Props {
  userId: string;
}

export default function PdfQuestionSetFromPdfPanel({ userId }: Props) {
  // --- Source ---
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [imagePages, setImagePages] = useState<string[]>([]);
  const imgElsRef = useRef<Map<number, HTMLImageElement>>(new Map());
  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(1);
  const [viewScale] = useState(1.35);
  const [sourceLabel, setSourceLabel] = useState("");

  // --- Phase ---
  const [phase, setPhase] = useState<"context" | "questions">("context");

  // --- Context region (Phase 1) ---
  const [contextPageRects, setContextPageRects] = useState<PageRects>({});
  const [contextText, setContextText] = useState("");

  // --- Per-question regions (Phase 2) ---
  const [qType, setQType] = useState<"mcq" | "frq">("mcq");
  const [pageRects, setPageRects] = useState<PageRects>({});
  const [drawMode, setDrawMode] = useState<RegionMode | null>(null);

  // --- Shared metadata ---
  const [subjectId, setSubjectId] = useState("");
  const [subjectName, setSubjectName] = useState("");
  const [courseLevel, setCourseLevel] = useState("");
  const [gradeLevel, setGradeLevel] = useState<number | "">("");
  const [tags, setTags] = useState("");

  // --- Per-question fields ---
  const [contentNote, setContentNote] = useState("");
  const [answer, setAnswer] = useState("");
  const [explanation, setExplanation] = useState("");
  const [explanationFile, setExplanationFile] = useState<File | null>(null);
  const [explanationPreview, setExplanationPreview] = useState<string | null>(null);
  const [rubricRows, setRubricRows] = useState<RubricRow[]>(() => defaultRubricRows());

  // --- Queue ---
  const [queue, setQueue] = useState<QueuedQuestion[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
    })();
  }, []);

  const hasSource = !!pdf || imagePages.length > 0;

  // --- Source loaders ---
  const clearSource = () => {
    setPdf(null);
    imagePages.forEach((u) => URL.revokeObjectURL(u));
    setImagePages([]);
    imgElsRef.current.clear();
    setNumPages(0);
    setContextPageRects({});
    setPageRects({});
    setPhase("context");
    setQueue([]);
    setMsg(null);
    setSourceLabel("");
  };

  const onPdfFile = async (file: File | null) => {
    clearSource();
    if (!file || file.type !== "application/pdf") {
      setMsg("Please choose a PDF file.");
      return;
    }
    try {
      const pdfjs = await import("pdfjs-dist");
      const buf = await file.arrayBuffer();
      const doc = await pdfjs.getDocument({ data: buf }).promise;
      setPdf(doc);
      setNumPages(doc.numPages);
      setPage(1);
      setSourceLabel(file.name);
    } catch {
      setMsg("Could not read this PDF.");
    }
  };

  const onImageFiles = (files: FileList | null) => {
    clearSource();
    if (!files || files.length === 0) return;
    const urls: string[] = [];
    for (let i = 0; i < files.length; i++) {
      if (!files[i].type.startsWith("image/")) continue;
      urls.push(URL.createObjectURL(files[i]));
    }
    if (urls.length === 0) {
      setMsg("No valid image files selected.");
      return;
    }
    setImagePages(urls);
    setNumPages(urls.length);
    setPage(1);
    setSourceLabel(`${urls.length} image(s)`);
  };

  // --- Region helpers ---
  const setContextRect = useCallback((mode: RegionMode, rect: NormRect) => {
    if (mode !== "context") return;
    setContextPageRects((prev) => ({
      ...prev,
      [page]: { ...(prev[page] || {}), context: rect },
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const clearContextRect = useCallback((mode: RegionMode) => {
    if (mode !== "context") return;
    setContextPageRects((prev) => {
      const pageR = { ...(prev[page] || {}) };
      delete pageR.context;
      return { ...prev, [page]: pageR };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const setQuestionRect = useCallback((mode: RegionMode, rect: NormRect) => {
    if (mode === "context") return;
    setPageRects((prev) => ({
      ...prev,
      [page]: { ...(prev[page] || {}), [mode]: rect },
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const clearQuestionRect = useCallback((mode: RegionMode) => {
    if (mode === "context") return;
    setPageRects((prev) => {
      const pageR = { ...(prev[page] || {}) };
      delete pageR[mode];
      return { ...prev, [page]: pageR };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const resetQuestionRegions = () => {
    setPageRects({});
    setAnswer("");
    setContentNote("");
    setExplanation("");
    if (explanationPreview) URL.revokeObjectURL(explanationPreview);
    setExplanationFile(null);
    setExplanationPreview(null);
    setRubricRows(defaultRubricRows());
    setDrawMode(null);
  };

  // --- Crop ---
  const cropRegion = async (rect: NormRect, pageNum: number): Promise<Blob> => {
    if (pdf) {
      return cropPdfRegionToPng(pdf, pageNum, CROP_SCALE, rect);
    }
    const imgEl = imgElsRef.current.get(pageNum);
    if (!imgEl) throw new Error("Image element not loaded for this page");
    return cropImageRegionToPng(imgEl, rect);
  };

  // Find a region across a page-keyed rects map
  const findRegionIn = (
    rects: PageRects,
    mode: RegionMode
  ): { pageNum: number; rect: NormRect } | null => {
    for (const [pStr, r] of Object.entries(rects)) {
      const found = r[mode];
      if (found) return { pageNum: Number(pStr), rect: found };
    }
    return null;
  };

  const findQuestionRegion = (mode: RegionMode) => findRegionIn(pageRects, mode);
  const contextRegion = findRegionIn(contextPageRects, "context");

  // All drawn modes for summary badges
  const allDrawnModes = (): { mode: RegionMode; page: number }[] => {
    const items: { mode: RegionMode; page: number }[] = [];
    // Context
    if (contextRegion) items.push({ mode: "context", page: contextRegion.pageNum });
    // Question regions
    for (const [pStr, rects] of Object.entries(pageRects)) {
      for (const m of Object.keys(rects) as RegionMode[]) {
        items.push({ mode: m, page: Number(pStr) });
      }
    }
    return items;
  };

  // --- Merged rects for workspace (show context + current question regions) ---
  const mergedCurrentPageRects: Partial<Record<RegionMode, NormRect>> = {
    ...(contextPageRects[page] || {}),
    ...(pageRects[page] || {}),
  };

  // Merged rects for thumbnail strip
  const mergedAllPageRects: PageRects = {};
  const allPages = new Set([
    ...Object.keys(contextPageRects).map(Number),
    ...Object.keys(pageRects).map(Number),
  ]);
  for (const p of allPages) {
    mergedAllPageRects[p] = {
      ...(contextPageRects[p] || {}),
      ...(pageRects[p] || {}),
    };
  }

  // --- Phase 1: Confirm context ---
  const confirmContext = () => {
    if (!contextRegion && !contextText.trim()) {
      setMsg("Draw a context region on the page and/or enter context text before proceeding.");
      return;
    }
    setMsg(null);
    setPhase("questions");
    setDrawMode(null);
  };

  const goBackToContext = () => {
    setPhase("context");
    resetQuestionRegions();
    setMsg(null);
  };

  // --- Phase 2: Add to queue ---
  const addToQueue = async () => {
    if (!hasSource) {
      setMsg("Upload a PDF or images first.");
      return;
    }
    const stemRegion = findQuestionRegion("stem");
    if (!stemRegion) {
      setMsg('Draw a box around the question stem (select "Question", then drag on the page).');
      return;
    }
    if (qType === "mcq") {
      for (const L of ["A", "B", "C", "D"] as const) {
        if (!findQuestionRegion(L)) {
          setMsg(`Draw a region for choice ${L}.`);
          return;
        }
      }
      const L = answer.trim().toUpperCase();
      if (!["A", "B", "C", "D"].includes(L)) {
        setMsg("Enter the correct choice letter: A, B, C, or D.");
        return;
      }
    } else {
      const rubric = buildRubricFromRows(rubricRows);
      if (!rubric) {
        setMsg("Fill at least one complete rubric row (name, expectations, points > 0).");
        return;
      }
      if (!answer.trim()) {
        setMsg("Type the model answer for this FRQ.");
        return;
      }
    }

    setBusy(true);
    setMsg(null);
    try {
      const stemBlob = await cropRegion(stemRegion.rect, stemRegion.pageNum);
      const stemFile = new File([stemBlob], "stem.png", { type: "image/png" });
      const question_image_url = await uploadQuestionImage(userId, stemFile);

      let options: { label: string; text: string; image_url?: string }[] | undefined;
      if (qType === "mcq") {
        options = [];
        for (const L of ["A", "B", "C", "D"] as const) {
          const region = findQuestionRegion(L)!;
          const blob = await cropRegion(region.rect, region.pageNum);
          const f = new File([blob], `choice-${L}.png`, { type: "image/png" });
          const url = await uploadQuestionImage(userId, f);
          options.push({ label: L, text: "", image_url: url });
        }
      }

      const rubric =
        qType === "frq" ? buildRubricFromRows(rubricRows) ?? undefined : undefined;

      let explanation_image_url: string | undefined;
      if (qType === "mcq" && explanationFile) {
        explanation_image_url = await uploadQuestionImage(userId, explanationFile);
      }

      const item: QueuedQuestion = {
        type: qType,
        question_image_url,
        options,
        answer: qType === "mcq" ? answer.trim().toUpperCase().slice(0, 1) : answer.trim(),
        rubric,
        content: contentNote.trim(),
        ...(qType === "mcq" && explanation.trim()
          ? { explanation: explanation.trim() }
          : {}),
        ...(qType === "mcq" && explanation_image_url
          ? { explanation_image_url }
          : {}),
      };

      setQueue((q) => [...q, item]);
      resetQuestionRegions();
      setMsg(`Question ${queue.length + 1} added. Draw regions for the next question or submit below.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Crop or upload failed.");
    } finally {
      setBusy(false);
    }
  };

  // --- Submit all ---
  const submitAll = async () => {
    if (queue.length === 0) {
      setMsg("Add at least one question to the queue.");
      return;
    }
    setBusy(true);
    setMsg(null);
    const n = queue.length;
    try {
      // 1. Crop & upload context image if drawn
      let context_image_url: string | undefined;
      if (contextRegion) {
        const blob = await cropRegion(contextRegion.rect, contextRegion.pageNum);
        const file = new File([blob], "context.png", { type: "image/png" });
        context_image_url = await uploadQuestionImage(userId, file);
      }

      // 2. Create the question set
      const set = await api.questionSets.create({
        context_text: contextText.trim() || (context_image_url ? "" : "(From PDF)"),
        ...(context_image_url ? { context_image_url } : {}),
      });

      // 3. Add each queued question
      for (const item of queue) {
        await api.questionSets.addQuestion(set.id, {
          type: item.type,
          subject: subjectName,
          subject_id: subjectId,
          ...(courseLevel ? { course_level: courseLevel } : {}),
          ...(gradeLevel !== "" ? { grade_level: Number(gradeLevel) } : {}),
          content: item.content || (pdf ? "(From PDF)" : "(From image)"),
          question_image_url: item.question_image_url,
          latex_enabled:
            item.content.includes("$") ||
            !!(item.explanation && item.explanation.includes("$")) ||
            contextText.includes("$"),
          answer: item.answer,
          ...(item.explanation ? { explanation: item.explanation } : {}),
          ...(item.explanation_image_url
            ? { explanation_image_url: item.explanation_image_url }
            : {}),
          tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
          options: item.options,
          rubric: item.rubric,
        });
      }

      setQueue([]);
      setMsg(
        `Saved question set with ${n} question(s) to your personal bank. Use My question bank to submit for community review.`
      );
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Submit failed.");
    } finally {
      setBusy(false);
    }
  };

  const regionSummary = allDrawnModes();

  return (
    <div className="card p-8 space-y-8 max-w-5xl">
      <div>
        <h2 className="text-xl font-semibold text-gray-800">Create a Question Set from PDF / Images</h2>
        <p className="text-sm text-gray-500 mt-1">
          Upload a PDF or images. First, draw a box around the shared context (passage / figure).
          Then add individual questions by drawing their stems and choices.
        </p>
      </div>

      {/* Phase indicator */}
      <div className="flex items-center gap-3">
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium ${
          phase === "context"
            ? "bg-cyan-100 text-cyan-800 ring-2 ring-cyan-300"
            : "bg-cyan-50 text-cyan-600"
        }`}>
          <span className="w-5 h-5 rounded-full bg-cyan-600 text-white text-xs flex items-center justify-center">1</span>
          Draw Context
        </div>
        <span className="text-gray-300">&rarr;</span>
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium ${
          phase === "questions"
            ? "bg-purple-100 text-purple-800 ring-2 ring-purple-300"
            : "bg-gray-100 text-gray-400"
        }`}>
          <span className={`w-5 h-5 rounded-full text-white text-xs flex items-center justify-center ${
            phase === "questions" ? "bg-purple-600" : "bg-gray-300"
          }`}>2</span>
          Add Questions
        </div>
        {phase === "questions" && (
          <button type="button" onClick={goBackToContext} className="text-sm text-cyan-700 hover:underline ml-2">
            Edit context
          </button>
        )}
      </div>

      {/* Upload section */}
      <div className="grid md:grid-cols-2 gap-6">
        <div className="space-y-3">
          <label className="block text-sm font-medium text-gray-700">PDF file</label>
          <input
            type="file"
            accept="application/pdf"
            className="text-sm"
            onChange={(e) => onPdfFile(e.target.files?.[0] ?? null)}
          />
          <label className="block text-sm font-medium text-gray-700 mt-2">
            Or select images <span className="text-gray-400">(multi-select)</span>
          </label>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            multiple
            className="text-sm"
            onChange={(e) => onImageFiles(e.target.files)}
          />
          {sourceLabel && <p className="text-xs text-gray-500">Loaded: {sourceLabel}</p>}
        </div>
        {phase === "questions" && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Question type</label>
              <select
                value={qType}
                onChange={(e) => {
                  setQType(e.target.value as "mcq" | "frq");
                  resetQuestionRegions();
                }}
                className="input-field"
              >
                <option value="mcq">Multiple choice</option>
                <option value="frq">Free response</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Context text (Phase 1) */}
      {phase === "context" && (
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700">
            Context text <span className="text-gray-400">(optional, accompanies the cropped region)</span>
          </label>
          <LatexHoverPreview value={contextText}>
            <textarea
              value={contextText}
              onChange={(e) => setContextText(e.target.value)}
              className="input-field min-h-[100px]"
              placeholder="Enter shared passage text or additional context (LaTeX: $...$)"
            />
          </LatexHoverPreview>
        </div>
      )}

      {/* Page thumbnail strip */}
      {hasSource && (
        <PageThumbnailStrip
          pdf={pdf}
          imagePages={imagePages}
          numPages={numPages}
          currentPage={page}
          onSelectPage={setPage}
          pageRects={mergedAllPageRects}
        />
      )}

      {/* Drawing mode buttons + workspace */}
      {hasSource && (
        <>
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-sm text-gray-600 mr-2">Drawing mode:</span>
            {phase === "context" ? (
              <button
                type="button"
                onClick={() => setDrawMode(drawMode === "context" ? null : "context")}
                className="text-sm px-3 py-1.5 rounded-lg border font-medium transition-colors"
                style={
                  drawMode === "context"
                    ? { backgroundColor: REGION_COLORS.context.border, color: "#fff", borderColor: REGION_COLORS.context.border }
                    : { borderColor: REGION_COLORS.context.border, color: REGION_COLORS.context.border, backgroundColor: REGION_COLORS.context.bg }
                }
              >
                {MODE_LABELS.context}
              </button>
            ) : (
              (["stem", ...(qType === "mcq" ? ["A", "B", "C", "D"] : [])] as RegionMode[]).map(
                (mode) => {
                  const active = drawMode === mode;
                  const c = REGION_COLORS[mode];
                  return (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setDrawMode(active ? null : mode)}
                      className="text-sm px-3 py-1.5 rounded-lg border font-medium transition-colors"
                      style={
                        active
                          ? { backgroundColor: c.border, color: "#fff", borderColor: c.border }
                          : { borderColor: c.border, color: c.border, backgroundColor: c.bg }
                      }
                    >
                      {MODE_LABELS[mode]}
                    </button>
                  );
                }
              )
            )}
            {phase === "questions" && (
              <button type="button" onClick={resetQuestionRegions} className="btn-secondary text-sm ml-2">
                Clear question regions
              </button>
            )}
          </div>

          {/* Region location summary */}
          {regionSummary.length > 0 && (
            <div className="flex flex-wrap gap-2 text-xs">
              {regionSummary.map(({ mode, page: p }) => (
                <span
                  key={`${mode}-${p}`}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-full border"
                  style={{
                    borderColor: REGION_COLORS[mode]?.border ?? "#666",
                    color: REGION_COLORS[mode]?.border ?? "#666",
                    backgroundColor: REGION_COLORS[mode]?.bg ?? "transparent",
                  }}
                >
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: REGION_COLORS[mode]?.border ?? "#666" }}
                  />
                  {MODE_LABELS[mode]}: Page {p}
                </span>
              ))}
            </div>
          )}

          {drawMode && (
            <p className="text-sm text-amber-800 bg-amber-50 rounded-lg px-3 py-2">
              Drag on the page to draw a box for: <strong>{MODE_LABELS[drawMode]}</strong>
            </p>
          )}

          {pdf ? (
            <PdfRegionWorkspace
              pdf={pdf}
              pageNumber={page}
              scale={viewScale}
              rects={mergedCurrentPageRects}
              activeMode={drawMode}
              onRectSet={phase === "context" ? setContextRect : setQuestionRect}
              onClear={phase === "context" ? clearContextRect : clearQuestionRect}
            />
          ) : imagePages.length > 0 ? (
            <ImageRegionWorkspace
              src={imagePages[page - 1]}
              rects={mergedCurrentPageRects}
              activeMode={drawMode}
              onRectSet={phase === "context" ? setContextRect : setQuestionRect}
              onClear={phase === "context" ? clearContextRect : clearQuestionRect}
              onImgRef={(el) => {
                if (el) imgElsRef.current.set(page, el);
              }}
            />
          ) : null}
        </>
      )}

      {/* Phase 1: Confirm context button */}
      {phase === "context" && hasSource && (
        <button
          type="button"
          onClick={confirmContext}
          className="btn-primary"
        >
          Confirm Context &amp; Add Questions &rarr;
        </button>
      )}

      {/* Phase 2: Metadata + per-question fields + queue */}
      {phase === "questions" && (
        <>
          <div className="grid md:grid-cols-2 gap-6 border-t border-gray-200 pt-6">
            <div className="space-y-3">
              <h3 className="font-medium text-gray-800">Shared metadata (all questions in set)</h3>
              <SubjectPicker
                subjectId={subjectId}
                onSubjectChange={(id, name) => { setSubjectId(id); setSubjectName(name); }}
                level={courseLevel}
                onLevelChange={setCourseLevel}
                allowAny={false}
              />
              <select
                value={gradeLevel}
                onChange={(e) =>
                  setGradeLevel(e.target.value === "" ? "" : Number(e.target.value))
                }
                className="input-field"
              >
                <option value="">Grade —</option>
                {[6, 7, 8, 9, 10, 11, 12].map((g) => (
                  <option key={g} value={g}>
                    Grade {g}
                  </option>
                ))}
              </select>
              <input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                className="input-field"
                placeholder="tags, comma-separated"
              />
            </div>

            <div className="space-y-3">
              <h3 className="font-medium text-gray-800">This question (before adding to list)</h3>
              <div>
                <label className="text-sm text-gray-600">Optional note / LaTeX (stored as text)</label>
                <LatexHoverPreview value={contentNote}>
                  <textarea
                    value={contentNote}
                    onChange={(e) => setContentNote(e.target.value)}
                    className="input-field min-h-[72px] mt-1"
                    placeholder="Optional short caption or math (e.g. $x^2$)"
                  />
                </LatexHoverPreview>
              </div>
              {qType === "mcq" ? (
                <>
                  <div>
                    <label className="text-sm text-gray-600">Correct answer (letter)</label>
                    <input
                      value={answer}
                      onChange={(e) => setAnswer(e.target.value.toUpperCase())}
                      maxLength={1}
                      className="input-field mt-1 w-24"
                      placeholder="A"
                    />
                  </div>
                  <div className="space-y-3 border-t border-gray-200 pt-4">
                    <h4 className="text-sm font-medium text-gray-800">
                      Explanation{" "}
                      <span className="text-gray-400 font-normal">(optional)</span>
                    </h4>
                    <LatexHoverPreview value={explanation}>
                      <textarea
                        value={explanation}
                        onChange={(e) => setExplanation(e.target.value)}
                        className="input-field min-h-[80px]"
                        placeholder="Why is this the correct answer? (LaTeX: $...$)"
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
                          if (explanationPreview) URL.revokeObjectURL(explanationPreview);
                          setExplanationFile(f);
                          if (f) {
                            setExplanationPreview(URL.createObjectURL(f));
                          } else {
                            setExplanationPreview(null);
                          }
                        }}
                      />
                      {explanationPreview && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={explanationPreview}
                          alt="Explanation preview"
                          className="mt-2 max-h-32 rounded border border-gray-200 object-contain"
                        />
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="text-sm text-gray-600">Model answer (typed)</label>
                    <LatexHoverPreview value={answer}>
                      <textarea
                        value={answer}
                        onChange={(e) => setAnswer(e.target.value)}
                        className="input-field min-h-[100px] mt-1"
                        placeholder="Ideal solution for grading reference (LaTeX: $...$)"
                      />
                    </LatexHoverPreview>
                  </div>
                  <RubricTableEditor rows={rubricRows} onChange={setRubricRows} />
                </>
              )}
              <button
                type="button"
                disabled={busy || !hasSource}
                onClick={() => void addToQueue()}
                className="btn-primary"
              >
                {busy ? "Processing\u2026" : "Crop, upload & add to set"}
              </button>
            </div>
          </div>

          {/* Queue */}
          {queue.length > 0 && (
            <div className="rounded-lg border border-purple-200 p-4 bg-purple-50/50">
              <h3 className="font-medium text-purple-800 mb-2">
                Question Set Queue ({queue.length})
              </h3>
              <ul className="text-sm text-gray-600 space-y-1 list-decimal list-inside">
                {queue.map((q, i) => (
                  <li key={i}>
                    {q.type.toUpperCase()} — answer: {q.answer.slice(0, 40)}
                    {q.answer.length > 40 ? "\u2026" : ""}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                disabled={busy}
                onClick={() => void submitAll()}
                className="btn-primary mt-4"
              >
                {busy ? "Submitting\u2026" : `Submit question set (${queue.length} question${queue.length !== 1 ? "s" : ""})`}
              </button>
            </div>
          )}
        </>
      )}

      {msg && (
        <p
          className={`text-sm rounded-lg p-3 ${
            msg.includes("Saved") || msg.includes("added")
              ? "bg-green-50 text-green-800"
              : "bg-amber-50 text-amber-900"
          }`}
        >
          {msg}
        </p>
      )}
    </div>
  );
}
