/**
 * Optional UI/debug metadata for local Ollama extraction (page + pipeline step).
 * Does not reflect true internal Ollama phases — see plan: "What is actually observable".
 */

export type ExtractionVisionStep = "layout" | "extract" | "fix" | "layout_only";

/** During an HTTP call: before first streamed token vs after (approximate "writing"). */
export type ExtractionInferencePhase = "waiting" | "generating";

export type ExtractionActiveVisionTask = {
  pageIndex: number;
  step: ExtractionVisionStep;
  inference: ExtractionInferencePhase;
};

/** One cross-page merge that the pipeline performed on multi-page sets. */
export type ExtractionStitchEvent = {
  /** 0-based global index of the surviving (merged) set. */
  targetSetIndex: number;
  /** 0-based page indices pulled into the merged set (sorted ascending). */
  sourcePageIndices: number[];
  /** Which continuation flag(s) triggered the merge. */
  reason: string;
  /** True when a single question was joined across the page break. */
  questionBridge: boolean;
};

export type ExtractionDebugSnapshot = {
  /** Current extraction mode selected by the pipeline. */
  extractionMode: "text" | "vision" | null;
  /** PDF rasterization progress (1-based page indices implied by completed/total). */
  raster: { completed: number; total: number } | null;
  /** In-flight Ollama vision calls; multiple entries when page_concurrency > 1. */
  activeVision: ExtractionActiveVisionTask[];
  /** Server analyze-stream NDJSON status phase (merge | cross_page | encode). */
  serverPhase: string | null;
  /** Multi-page stitching performed during merge, in the order it happened. */
  stitches: ExtractionStitchEvent[];
};

export function createEmptyExtractionDebugSnapshot(): ExtractionDebugSnapshot {
  return {
    extractionMode: null,
    raster: null,
    activeVision: [],
    serverPhase: null,
    stitches: [],
  };
}

export function isExtractionDebugUiEnabled(): boolean {
  return (
    typeof process !== "undefined" &&
    process.env.NEXT_PUBLIC_EXTRACTION_DEBUG_UI?.trim() === "true"
  );
}

/** When true with debug UI, use streaming chat to distinguish waiting vs generating. */
export function isExtractionDebugStreamEnabled(): boolean {
  if (!isExtractionDebugUiEnabled()) return false;
  const v = process.env.NEXT_PUBLIC_EXTRACTION_DEBUG_STREAM?.trim();
  if (v === "false") return false;
  return true;
}
