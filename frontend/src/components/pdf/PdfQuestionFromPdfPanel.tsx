"use client";

import { useState, useCallback, useEffect } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { CourseLevel } from "@/types";
import { api } from "@/lib/api";
import { uploadQuestionImage } from "@/lib/questionImageUpload";
import { cropPdfRegionToPng, type NormRect } from "@/lib/pdf/cropPdfPage";
import PdfRegionWorkspace, {
  type RegionMode,
  MODE_LABELS,
} from "./PdfRegionWorkspace";
import RubricTableEditor, {
  type RubricRow,
  defaultRubricRows,
  buildRubricFromRows,
} from "../RubricTableEditor";

const CROP_SCALE = 2.5;

type QueuedQuestion = {
  type: "mcq" | "frq";
  question_image_url: string;
  options?: { label: string; text: string; image_url?: string }[];
  answer: string;
  rubric?: Record<string, unknown>;
  content: string;
};

interface Props {
  userId: string;
}

export default function PdfQuestionFromPdfPanel({ userId }: Props) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(1);
  const [viewScale] = useState(1.35);
  const [pdfName, setPdfName] = useState("");

  const [qType, setQType] = useState<"mcq" | "frq">("mcq");
  const [rects, setRects] = useState<Partial<Record<RegionMode, NormRect>>>({});
  const [drawMode, setDrawMode] = useState<RegionMode | null>(null);

  const [subject, setSubject] = useState("Mathematics");
  const [difficulty, setDifficulty] = useState<"easy" | "medium" | "hard">("medium");
  const [courseLevel, setCourseLevel] = useState<CourseLevel | "">("");
  const [gradeLevel, setGradeLevel] = useState<number | "">("");
  const [tags, setTags] = useState("");

  const [contentNote, setContentNote] = useState("");
  const [answer, setAnswer] = useState("");
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

  const onPdfFile = async (file: File | null) => {
    setPdf(null);
    setNumPages(0);
    setRects({});
    setMsg(null);
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
      setPdfName(file.name);
    } catch {
      setMsg("Could not read this PDF.");
    }
  };

  const setRect = useCallback((mode: RegionMode, rect: NormRect) => {
    setRects((r) => ({ ...r, [mode]: rect }));
  }, []);

  const clearRect = useCallback((mode: RegionMode) => {
    setRects((r) => {
      const next = { ...r };
      delete next[mode];
      return next;
    });
  }, []);

  const resetCurrentRegions = () => {
    setRects({});
    setAnswer("");
    setContentNote("");
    setRubricRows(defaultRubricRows());
    setDrawMode(null);
  };

  const addToQueue = async () => {
    if (!pdf) {
      setMsg("Upload a PDF first.");
      return;
    }
    if (!rects.stem) {
      setMsg("Draw a box around the question (select “Draw question region”, then drag on the page).");
      return;
    }
    if (qType === "mcq") {
      for (const L of ["A", "B", "C", "D"] as const) {
        if (!rects[L]) {
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
      const stemBlob = await cropPdfRegionToPng(pdf, page, CROP_SCALE, rects.stem);
      const stemFile = new File([stemBlob], "stem.png", { type: "image/png" });
      const question_image_url = await uploadQuestionImage(userId, stemFile);

      let options: { label: string; text: string; image_url?: string }[] | undefined;
      if (qType === "mcq") {
        const labels = ["A", "B", "C", "D"] as const;
        options = [];
        for (const L of labels) {
          const r = rects[L]!;
          const blob = await cropPdfRegionToPng(pdf, page, CROP_SCALE, r);
          const f = new File([blob], `choice-${L}.png`, { type: "image/png" });
          const url = await uploadQuestionImage(userId, f);
          options.push({ label: L, text: "", image_url: url });
        }
      }

      const rubric =
        qType === "frq" ? buildRubricFromRows(rubricRows) ?? undefined : undefined;

      const item: QueuedQuestion = {
        type: qType,
        question_image_url,
        options,
        answer: qType === "mcq" ? answer.trim().toUpperCase().slice(0, 1) : answer.trim(),
        rubric,
        content: contentNote.trim(),
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
          subject,
          difficulty,
          ...(courseLevel ? { course_level: courseLevel } : {}),
          ...(gradeLevel !== "" ? { grade_level: Number(gradeLevel) } : {}),
          content: item.content || "(From PDF)",
          question_image_url: item.question_image_url,
          latex_enabled: item.content.includes("$"),
          answer: item.answer,
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

  return (
    <div className="card p-8 space-y-8 max-w-5xl">
      <div>
        <h2 className="text-xl font-semibold text-gray-800">Create questions from a PDF</h2>
        <p className="text-sm text-gray-500 mt-1">
          Upload a multi-page PDF, pick a page, then drag rectangles on the preview. Mark the
          question block, and for MCQs mark each choice (A–D). FRQs use the rubric table; type the
          model answer. Add each question to the list, then submit all.
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
          {pdfName && <p className="text-xs text-gray-500">Loaded: {pdfName}</p>}
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
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Page</label>
            <select
              value={page}
              onChange={(e) => {
                setPage(Number(e.target.value));
                setRects({});
                setDrawMode(null);
              }}
              className="input-field"
              disabled={!pdf}
            >
              {Array.from({ length: numPages }, (_, i) => i + 1).map((p) => (
                <option key={p} value={p}>
                  Page {p}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {pdf && (
        <>
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-sm text-gray-600 mr-2">Drawing mode:</span>
            <button
              type="button"
              onClick={() => setDrawMode(drawMode === "stem" ? null : "stem")}
              className={`text-sm px-3 py-1.5 rounded-lg border ${
                drawMode === "stem"
                  ? "bg-primary-600 text-white border-primary-600"
                  : "bg-white border-gray-300"
              }`}
            >
              {MODE_LABELS.stem}
            </button>
            {qType === "mcq" &&
              (["A", "B", "C", "D"] as const).map((L) => (
                <button
                  key={L}
                  type="button"
                  onClick={() => setDrawMode(drawMode === L ? null : L)}
                  className={`text-sm px-3 py-1.5 rounded-lg border ${
                    drawMode === L
                      ? "bg-primary-600 text-white border-primary-600"
                      : "bg-white border-gray-300"
                  }`}
                >
                  {MODE_LABELS[L]}
                </button>
              ))}
            <button type="button" onClick={resetCurrentRegions} className="btn-secondary text-sm ml-2">
              Clear all regions
            </button>
          </div>
          {drawMode && (
            <p className="text-sm text-amber-800 bg-amber-50 rounded-lg px-3 py-2">
              Drag on the page to draw a box for: <strong>{MODE_LABELS[drawMode]}</strong>
            </p>
          )}

          <PdfRegionWorkspace
            pdf={pdf}
            pageNumber={page}
            scale={viewScale}
            rects={rects}
            activeMode={drawMode}
            onRectSet={setRect}
            onClear={clearRect}
          />
        </>
      )}

      <div className="grid md:grid-cols-2 gap-6 border-t border-gray-200 pt-6">
        <div className="space-y-3">
          <h3 className="font-medium text-gray-800">Shared metadata (all queued questions)</h3>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="input-field"
            placeholder="Subject"
          />
          <div className="grid grid-cols-2 gap-2">
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
              value={courseLevel}
              onChange={(e) => setCourseLevel(e.target.value as CourseLevel | "")}
              className="input-field"
            >
              <option value="">Level —</option>
              <option value="S">S</option>
              <option value="S+">S+</option>
              <option value="H">H</option>
              <option value="H+">H+</option>
            </select>
          </div>
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
            <textarea
              value={contentNote}
              onChange={(e) => setContentNote(e.target.value)}
              className="input-field min-h-[72px] mt-1"
              placeholder="Optional short caption or math (e.g. $x^2$)"
            />
          </div>
          {qType === "mcq" ? (
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
          ) : (
            <>
              <div>
                <label className="text-sm text-gray-600">Model answer (typed)</label>
                <textarea
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  className="input-field min-h-[100px] mt-1"
                  placeholder="Ideal solution for grading reference"
                />
              </div>
              <RubricTableEditor rows={rubricRows} onChange={setRubricRows} />
            </>
          )}
          <button
            type="button"
            disabled={busy || !pdf}
            onClick={() => void addToQueue()}
            className="btn-primary"
          >
            {busy ? "Processing…" : "Crop, upload & add to list"}
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
                {q.answer.length > 40 ? "…" : ""}
              </li>
            ))}
          </ul>
          <button
            type="button"
            disabled={busy}
            onClick={() => void submitAll()}
            className="btn-primary mt-4"
          >
            {busy ? "Submitting…" : `Submit all ${queue.length} question(s)`}
          </button>
        </div>
      )}

      {msg && (
        <p
          className={`text-sm rounded-lg p-3 ${
            msg.includes("Submitted") || msg.includes("added")
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
