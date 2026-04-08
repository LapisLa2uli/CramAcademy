import { collectExtractionWarnings } from "@/lib/extraction/collectExtractionWarnings";
import { extractPageLocal } from "@/lib/extraction/extractPageLocal";
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

export function getLocalOllamaConfig(): {
  baseUrl: string;
  model: string;
  useJsonSchema: boolean;
} {
  const baseUrl =
    (typeof process !== "undefined" &&
      process.env?.NEXT_PUBLIC_OLLAMA_BASE_URL?.trim()) ||
    "http://127.0.0.1:11434";
  const model =
    (typeof process !== "undefined" &&
      process.env?.NEXT_PUBLIC_OLLAMA_MODEL?.trim()) ||
    "qwen2.5vl";
  const useJsonSchema =
    (typeof process !== "undefined" &&
      process.env?.NEXT_PUBLIC_EXTRACTION_USE_JSON_SCHEMA?.trim()) === "true";
  return { baseUrl, model, useJsonSchema };
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
    high_accuracy?: boolean;
    two_stage?: boolean;
    layout_only?: boolean;
    onProgress?: (completed: number, total: number) => void;
    signal?: AbortSignal;
  }
): Promise<ExtractionAnalyzeResponse> {
  const maxPages = options.max_pages ?? 24;
  const dpi = options.dpi ?? 160;
  const highAccuracy = options.high_accuracy ?? false;
  const twoStage = options.two_stage ?? false;
  const layoutOnly = options.layout_only ?? false;

  const maxEdge = highAccuracy ? 2560 : 1920;
  const effectiveTwoStage = twoStage && !layoutOnly;

  /** Two-phase bar: first half = rasterizing pages, second half = vision per page (2× pageCount steps). */
  const reportProgress = (completedUnits: number, totalUnits: number) => {
    options.onProgress?.(completedUnits, totalUnits);
  };

  reportProgress(0, 2 * maxPages);

  const pages = await preparePagesFromFiles(files, {
    maxPages,
    dpi,
    maxEdge,
    onPagePrepared: ({ completed, total }) => {
      const totalUnits = 2 * total;
      reportProgress(completed, totalUnits);
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
  const totalUnits = 2 * n;
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

  const { baseUrl, model, useJsonSchema } = getLocalOllamaConfig();
  const concurrency = 4;
  let visionDone = 0;

  const pageRaw = await mapWithConcurrency(pages, concurrency, async (p) => {
    const ptext = layoutOnly ? null : pdfTextByPage[p.pageIndex] ?? null;
    const { data, warnings } = await extractPageLocal({
      pageIndex: p.pageIndex,
      pngBytes: p.pngBytes,
      baseUrl,
      model,
      useJsonSchema,
      pdfPageText: ptext,
      twoStage: effectiveTwoStage,
      layoutOnly,
      signal: options.signal,
    });
    visionDone += 1;
    reportProgress(n + visionDone, totalUnits);
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

  return {
    warnings: warn,
    pages: merged.pages,
    sets: merged.sets,
  };
}
