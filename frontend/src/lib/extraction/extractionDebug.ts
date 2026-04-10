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

export type ExtractionDebugSnapshot = {
  /** PDF rasterization progress (1-based page indices implied by completed/total). */
  raster: { completed: number; total: number } | null;
  /** In-flight Ollama vision calls; multiple entries when page_concurrency > 1. */
  activeVision: ExtractionActiveVisionTask[];
  /** Server analyze-stream NDJSON status phase (merge | cross_page | encode). */
  serverPhase: string | null;
};

export function createEmptyExtractionDebugSnapshot(): ExtractionDebugSnapshot {
  return {
    raster: null,
    activeVision: [],
    serverPhase: null,
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
