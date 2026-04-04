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

/** Page-keyed rects: pageNumber -> { mode -> NormRect } */
type PageRects = Record<number, Partial<Record<RegionMode, NormRect>>>;

interface Props {
  userId: string;
}

export default function PdfQuestionFromPdfPanel({ userId }: Props) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [imagePages, setImagePages] = useState<string[]>([]);
  const imgElsRef = useRef<Map<number, HTMLImageElement>>(new Map());
  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(1);
  const [viewScale] = useState(1.35);
  const [sourceLabel, setSourceLabel] = useState("");

  const [qType, setQType] = useState<"mcq" | "frq">("mcq");
  // Page-aware rects
  const [pageRects, setPageRects] = useState<PageRects>({});
  const [drawMode, setDrawMode] = useState<RegionMode | null>(null);

  const [subjectId, setSubjectId] = useState("");
  const [subjectName, setSubjectName] = useState("");
  const [difficulty, setDifficulty] = useState<"easy" | "medium" | "hard">("medium");
  const [courseLevel, setCourseLevel] = useState("");
  const [gradeLevel, setGradeLevel] = useState<number | "">("");
  const [tags, setTags] = useState("");

  const [contentNote, setContentNote] = useState("");
  const [answer, setAnswer] = useState("");
  const [explanation, setExplanation] = useState("");
  const [explanationFile, setExplanationFile] = useState<File | null>(null);
  const [explanationPreview, setExplanationPreview] = useState<string | null>(null);
  const [rubricRows, setRubricRows] = useState<RubricRow[]>(() => defaultRubricRows());

  const [queue, setQueue] = useState<QueuedQuestion[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
    })();
  }, []);

  const clearSource = () => {
    setPdf(null);
    imagePages.forEach((u) => URL.revokeObjectURL(u));
    setImagePages([]);
    imgElsRef.current.clear();
    setNumPages(0);
    setPageRects({});
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

  // Page-aware rect setters
  const setRect = useCallback((mode: RegionMode, rect: NormRect) => {
    setPageRects((prev) => ({
      ...prev,
      [page]: { ...(prev[page] || {}), [mode]: rect },
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const clearRect = useCallback((mode: RegionMode) => {
    setPageRects((prev) => {
      const pageR = { ...(prev[page] || {}) };
      delete pageR[mode];
      return { ...prev, [page]: pageR };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const resetCurrentRegions = () => {
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

  // Crop a region from a specific page
  const cropRegion = async (rect: NormRect, pageNum: number): Promise<Blob> => {
    if (pdf) {
      return cropPdfRegionToPng(pdf, pageNum, CROP_SCALE, rect);
    }
    const imgEl = imgElsRef.current.get(pageNum);
    if (!imgEl) throw new Error("Image element not loaded for this page");
    return cropImageRegionToPng(imgEl, rect);
  };

  // Find which page a given region mode is on
  const findRegion = (mode: RegionMode): { pageNum: number; rect: NormRect } | null => {
    for (const [pStr, rects] of Object.entries(pageRects)) {
      const r = rects[mode];
      if (r) return { pageNum: Number(pStr), rect: r };
    }
    return null;
  };

  // Collect all drawn region modes across all pages
  const allDrawnModes = (): RegionMode[] => {
    const modes = new Set<RegionMode>();
    for (const rects of Object.values(pageRects)) {
      for (const m of Object.keys(rects) as RegionMode[]) {
        modes.add(m);
      }
    }
    return [...modes];
  };

  const addToQueue = async () => {
    if (!pdf && imagePages.length === 0) {
      setMsg("Upload a PDF or images first.");
      return;
    }

    const stemRegion = findRegion("stem");
    if (!stemRegion) {
      setMsg("Draw a box around the question (select \u201cDraw question region\u201d, then drag on the page).");
      return;
    }
    if (qType === "mcq") {
      for (const L of ["A", "B", "C", "D"] as const) {
        if (!findRegion(L)) {
          setMsg(`Draw a region for choice ${L}.`);
          return;
        }
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
    if (qType === "mcq") {
      const L = answer.trim().toUpperCase();
      if (!["A", "B", "C", "D"].includes(L)) {
        setMsg("Enter the correct choice letter: A, B, C, or D.");
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
        const labels = ["A", "B", "C", "D"] as const;
        options = [];
        for (const L of labels) {
          const region = findRegion(L)!;
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
      resetCurrentRegions();
      setMsg("Question added to the list. Define another region set or submit below.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Crop or upload failed.");
    } finally {
      setBusy(false);
    }
  };

  const submitAll = async () => {
    if (queue.length === 0) {
      setMsg("Add at least one question to the queue.");
      return;
    }
    setBusy(true);
    setMsg(null);
    const n = queue.length;
    try {
      for (const item of queue) {
        await api.questions.create({
          type: item.type,
          subject: subjectName,
          subject_id: subjectId,
          difficulty,
          ...(courseLevel ? { course_level: courseLevel } : {}),
          ...(gradeLevel !== "" ? { grade_level: Number(gradeLevel) } : {}),
          content: item.content || (pdf ? "(From PDF)" : "(From image)"),
          question_image_url: item.question_image_url,
          latex_enabled:
            item.content.includes("$") ||
            !!(item.explanation && item.explanation.includes("$")),
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
        `Saved ${n} question(s) to your personal bank. Use My question bank to submit any for community review.`
      );
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Submit failed.");
    } finally {
      setBusy(false);
    }
  };

  // Current page rects for the workspace
  const currentPageRects = pageRects[page] || {};

  // Build region location summary
  const drawnModes = allDrawnModes();
  const regionSummaryItems = drawnModes.map((mode) => {
    const region = findRegion(mode);
    return region ? { mode, page: region.pageNum } : null;
  }).filter(Boolean) as { mode: RegionMode; page: number }[];

  return (
    <div className="card p-8 space-y-8 max-w-5xl">
      <div>
        <h2 className="text-xl font-semibold text-gray-800">Create questions from a PDF or images</h2>
        <p className="text-sm text-gray-500 mt-1">
          Upload a multi-page PDF or select multiple images. Scroll through pages and drag
          rectangles on the preview &mdash; regions persist across pages, so you can select the
          question from one page and choices from another.
        </p>
      </div>

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
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Question type</label>
            <select
              value={qType}
              onChange={(e) => {
                setQType(e.target.value as "mcq" | "frq");
                resetCurrentRegions();
              }}
              className="input-field"
            >
              <option value="mcq">Multiple choice</option>
              <option value="frq">Free response</option>
            </select>
          </div>
        </div>
      </div>

      {/* Page thumbnail strip */}
      {(pdf || imagePages.length > 0) && (
        <PageThumbnailStrip
          pdf={pdf}
          imagePages={imagePages}
          numPages={numPages}
          currentPage={page}
          onSelectPage={setPage}
          pageRects={pageRects}
        />
      )}

      {(pdf || imagePages.length > 0) && (
        <>
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-sm text-gray-600 mr-2">Drawing mode:</span>
            {(["stem", ...(qType === "mcq" ? ["A", "B", "C", "D"] : [])] as RegionMode[]).map(
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
            )}
            <button type="button" onClick={resetCurrentRegions} className="btn-secondary text-sm ml-2">
              Clear all regions
            </button>
          </div>

          {/* Region location summary */}
          {regionSummaryItems.length > 0 && (
            <div className="flex flex-wrap gap-2 text-xs">
              {regionSummaryItems.map(({ mode, page: p }) => (
                <span
                  key={mode}
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
              rects={currentPageRects}
              activeMode={drawMode}
              onRectSet={setRect}
              onClear={clearRect}
            />
          ) : imagePages.length > 0 ? (
            <ImageRegionWorkspace
              src={imagePages[page - 1]}
              rects={currentPageRects}
              activeMode={drawMode}
              onRectSet={setRect}
              onClear={clearRect}
              onImgRef={(el) => {
                if (el) imgElsRef.current.set(page, el);
              }}
            />
          ) : null}
        </>
      )}

      <div className="grid md:grid-cols-2 gap-6 border-t border-gray-200 pt-6">
        <div className="space-y-3">
          <h3 className="font-medium text-gray-800">Shared metadata (all queued questions)</h3>
          <SubjectPicker
            subjectId={subjectId}
            onSubjectChange={(id, name) => { setSubjectId(id); setSubjectName(name); }}
            level={courseLevel}
            onLevelChange={setCourseLevel}
            allowAny={false}
          />
          <select
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value as "easy" | "medium" | "hard")}
            className="input-field"
          >
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>
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
                  <span className="text-gray-400 font-normal">(optional; shown after grading)</span>
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
                      if (explanationPreview) {
                        URL.revokeObjectURL(explanationPreview);
                      }
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
            disabled={busy || (!pdf && imagePages.length === 0)}
            onClick={() => void addToQueue()}
            className="btn-primary"
          >
            {busy ? "Processing\u2026" : "Crop, upload & add to list"}
          </button>
        </div>
      </div>

      {queue.length > 0 && (
        <div className="rounded-lg border border-gray-200 p-4 bg-gray-50">
          <h3 className="font-medium text-gray-800 mb-2">Queue ({queue.length})</h3>
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
            {busy ? "Submitting\u2026" : `Submit all ${queue.length} question(s)`}
          </button>
        </div>
      )}

      {msg && (
        <p
          className={`text-sm rounded-lg p-3 ${
            msg.includes("Saved") || msg.includes("added") || msg.includes("Submitted")
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
