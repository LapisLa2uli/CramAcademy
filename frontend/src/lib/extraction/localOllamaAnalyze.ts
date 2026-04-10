import { collectExtractionWarnings } from "@/lib/extraction/collectExtractionWarnings";
import {
  createEmptyExtractionDebugSnapshot,
  isExtractionDebugStreamEnabled,
  type ExtractionActiveVisionTask,
  type ExtractionDebugSnapshot,
} from "@/lib/extraction/extractionDebug";
import { extractPageLocal, type VisionActivityEvent, type VisionInferenceEvent } from "@/lib/extraction/extractPageLocal";
import { mergePageResults } from "@/lib/extraction/mergePageResults";
import { preparePagesFromFiles } from "@/lib/extraction/preparePagesFromFiles";
import { extractPdfPageTexts } from "@/lib/extraction/extractPdfTextHints";
import type { ExtractionAnalyzeResponse } from "@/types";

function isPdfSingle(files: File[]): boolean {
  return (
    files.length === 1 &&
    (files[0].type === "application/pdf" || /\.pdf$/i.test(files[0].name))
  );
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const idx = next;
      next += 1;
      if (idx >= items.length) break;
      results[idx] = await fn(items[idx], idx);
    }
  }
  const n = Math.min(concurrency, Math.max(1, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

/** Local HTTPS proxy (see `npm run ollama-https-proxy`); avoids mixed content from https:// deployments. */
const DEFAULT_OLLAMA_BROWSER_BASE = "https://127.0.0.1:8443";

/**
 * Resolves the OpenAI-compatible base URL for browser → Ollama.
 * When the app is served over HTTPS (e.g. Vercel), `http://127.0.0.1:11434` is never reachable (mixed content).
 * If env still points at plain HTTP **direct Ollama**, upgrade to the local HTTPS proxy URL at runtime.
 */
function resolveOllamaBaseUrl(): string {
  const raw =
    typeof process !== "undefined" && process.env?.NEXT_PUBLIC_OLLAMA_BASE_URL?.trim()
      ? process.env.NEXT_PUBLIC_OLLAMA_BASE_URL.trim()
      : DEFAULT_OLLAMA_BROWSER_BASE;
  let baseUrl = raw.replace(/\/$/, "");

  if (typeof window !== "undefined" && window.location.protocol === "https:") {
    const lower = baseUrl.toLowerCase();
    if (lower === "http://127.0.0.1:11434" || lower === "http://localhost:11434") {
      baseUrl = DEFAULT_OLLAMA_BROWSER_BASE.replace(/\/$/, "");
    }
  }

  return baseUrl;
}

function parsePageConcurrency(): number {
  const raw =
    typeof process !== "undefined" && process.env?.NEXT_PUBLIC_OLLAMA_PAGE_CONCURRENCY?.trim();
  if (!raw) return 1;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return 1;
  return Math.min(8, Math.max(1, n));
}

function parseEnvPositiveInt(envKey: string, fallback: number): number {
  if (typeof process === "undefined") return fallback;
  const v = process.env[envKey]?.trim();
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Defaults tuned for speed / lower VRAM when high_accuracy is off. */
function defaultRasterDpi(): number {
  return parseEnvPositiveInt("NEXT_PUBLIC_OLLAMA_RASTER_DPI", 128);
}

/** Initial values for local-Ollama UI (env-based; user can override in the extraction wizard). */
export function getLocalOllamaRasterDefaults(): { rasterDpi: number; pageConcurrency: number } {
  return {
    rasterDpi: defaultRasterDpi(),
    pageConcurrency: parsePageConcurrency(),
  };
}

function defaultMaxEdge(highAccuracy: boolean): number {
  return highAccuracy
    ? parseEnvPositiveInt("NEXT_PUBLIC_OLLAMA_MAX_EDGE_HIGH", 2560)
    : parseEnvPositiveInt("NEXT_PUBLIC_OLLAMA_MAX_EDGE", 1280);
}

function parseImageDetail(): "low" | "high" {
  const raw =
    typeof process !== "undefined" && process.env?.NEXT_PUBLIC_OLLAMA_IMAGE_DETAIL?.trim().toLowerCase();
  return raw === "high" ? "high" : "low";
}

export function getLocalOllamaConfig(): {
  baseUrl: string;
  model: string;
  useJsonSchema: boolean;
  pageConcurrency: number;
  imageDetail: "low" | "high";
} {
  const baseUrl = resolveOllamaBaseUrl();
  const model =
    (typeof process !== "undefined" &&
      process.env?.NEXT_PUBLIC_OLLAMA_MODEL?.trim()) ||
    "llava:7b";
  const useJsonSchema =
    (typeof process !== "undefined" &&
      process.env?.NEXT_PUBLIC_EXTRACTION_USE_JSON_SCHEMA?.trim()) === "true";
  return {
    baseUrl,
    model,
    useJsonSchema,
    pageConcurrency: parsePageConcurrency(),
    imageDetail: parseImageDetail(),
  };
}

export function isClientOllamaExtractionEnabled(): boolean {
  return (
    typeof process !== "undefined" &&
    process.env?.NEXT_PUBLIC_EXTRACTION_MODE === "local_ollama"
  );
}

export async function runLocalOllamaAnalyze(
  files: File[],
  options: {
    max_pages?: number;
    dpi?: number;
    /** Parallel pages; 1–8. Omit to use env `NEXT_PUBLIC_OLLAMA_PAGE_CONCURRENCY` / defaults. */
    page_concurrency?: number;
    high_accuracy?: boolean;
    two_stage?: boolean;
    layout_only?: boolean;
    onProgress?: (completed: number, total: number) => void;
    /** Debug panel: raster + in-flight vision steps (page + step + inference). */
    onExtractionDebug?: (snapshot: ExtractionDebugSnapshot) => void;
    signal?: AbortSignal;
  }
): Promise<ExtractionAnalyzeResponse> {
  const maxPages = options.max_pages ?? 24;
  const highAccuracy = options.high_accuracy ?? false;
  const twoStage = options.two_stage ?? false;
  const layoutOnly = options.layout_only ?? false;

  const dpi = options.dpi ?? defaultRasterDpi();
  const maxEdge = defaultMaxEdge(highAccuracy);
  const effectiveTwoStage = twoStage && !layoutOnly;

  /** Max Ollama calls per page we reserve progress for (layout + main + optional validation fix). */
  const maxVisionSubstepsPerPage = layoutOnly ? 1 : effectiveTwoStage ? 3 : 2;

  /** Total steps = raster (n) + vision substeps (n × maxVisionSubstepsPerPage). */
  const reportProgress = (completedUnits: number, totalUnits: number) => {
    options.onProgress?.(completedUnits, totalUnits);
  };

  reportProgress(0, 1);

  const debugCb = options.onExtractionDebug;
  const snap = createEmptyExtractionDebugSnapshot();
  const activeVision = new Map<string, ExtractionActiveVisionTask>();

  const emitDebug = () => {
    debugCb?.({
      raster: snap.raster,
      activeVision: [...activeVision.values()],
      serverPhase: snap.serverPhase,
    });
  };

  const onVisionActivity =
    debugCb != null
      ? (ev: VisionActivityEvent) => {
          const key = `${ev.pageIndex}:${ev.step}`;
          if (ev.phase === "start") {
            activeVision.set(key, {
              pageIndex: ev.pageIndex,
              step: ev.step,
              inference: "waiting",
            });
          } else {
            activeVision.delete(key);
          }
          emitDebug();
        }
      : undefined;

  const onInferencePhase =
    debugCb != null
      ? (ev: VisionInferenceEvent) => {
          const key = `${ev.pageIndex}:${ev.step}`;
          const cur = activeVision.get(key);
          if (cur) {
            cur.inference = ev.inference;
            activeVision.set(key, cur);
          }
          emitDebug();
        }
      : undefined;

  const useInferenceStream = debugCb != null && isExtractionDebugStreamEnabled();

  const pages = await preparePagesFromFiles(files, {
    maxPages,
    dpi,
    maxEdge,
    onPagePrepared: ({ completed, total }) => {
      if (debugCb) {
        snap.raster = { completed, total };
        emitDebug();
      }
      const prepTotal = total * (1 + maxVisionSubstepsPerPage);
      reportProgress(completed, prepTotal);
    },
  });

  if (pages.length === 0) {
    return {
      warnings: ["No pages to analyze."],
      pages: [],
      sets: [],
    };
  }

  const n = pages.length;
  const totalUnits = n * (1 + maxVisionSubstepsPerPage);
  reportProgress(n, totalUnits);

  let pdfTextByPage: Record<number, string> = {};
  if (!layoutOnly && files.length === 1 && isPdfSingle(files)) {
    try {
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      pdfTextByPage = await extractPdfPageTexts(files[0], maxPages);
    } catch {
      pdfTextByPage = {};
    }
  }

  const { baseUrl, model, useJsonSchema, pageConcurrency: envConcurrency, imageDetail } =
    getLocalOllamaConfig();
  const concurrency =
    options.page_concurrency != null
      ? Math.min(8, Math.max(1, Math.floor(options.page_concurrency)))
      : envConcurrency;

  const visionSlotTotal = n * maxVisionSubstepsPerPage;
  let visionSubstepsDone = 0;
  const onVisionSubstep = () => {
    visionSubstepsDone += 1;
    reportProgress(n + Math.min(visionSubstepsDone, visionSlotTotal), totalUnits);
  };

  const pageRaw = await mapWithConcurrency(pages, concurrency, async (p) => {
    const ptext = layoutOnly ? null : pdfTextByPage[p.pageIndex] ?? null;
    const { data, warnings } = await extractPageLocal({
      pageIndex: p.pageIndex,
      pngBytes: p.pngBytes,
      baseUrl,
      model,
      useJsonSchema,
      imageDetail,
      pdfPageText: ptext,
      twoStage: effectiveTwoStage,
      layoutOnly,
      signal: options.signal,
      onVisionSubstep,
      onVisionActivity,
      onInferencePhase,
      useInferenceStream,
    });
    return {
      pageIndex: p.pageIndex,
      raw: data,
      pngBytes: p.pngBytes,
      w: p.width,
      h: p.height,
      warn: warnings,
    };
  });

  pageRaw.sort((a, b) => a.pageIndex - b.pageIndex);

  const merged = mergePageResults(
    pageRaw.map((r) => ({
      pageIndex: r.pageIndex,
      raw: r.raw,
      pngBytes: r.pngBytes,
      w: r.w,
      h: r.h,
    }))
  );

  const warn: string[] = [];
  for (const r of pageRaw) {
    warn.push(...r.warn);
  }
  warn.push(...collectExtractionWarnings(merged.sets));

  reportProgress(totalUnits, totalUnits);

  return {
    warnings: warn,
    pages: merged.pages,
    sets: merged.sets,
  };
}
