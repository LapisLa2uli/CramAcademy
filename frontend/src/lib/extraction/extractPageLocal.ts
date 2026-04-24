import {
  FIX_OUTPUT_SYSTEM,
  LAYOUT_ONLY_SYSTEM,
  PAGE_EXTRACTION_SYSTEM,
  fixOutputUser,
  layoutOnlyUser,
  pageExtractionUser,
} from "@/lib/extraction/extractionPrompts";
import type { ExtractionVisionStep } from "@/lib/extraction/extractionDebug";
import { ollamaChatCompletion, type ChatMessage } from "@/lib/extraction/ollamaOpenAI";

export type VisionActivityEvent = {
  pageIndex: number;
  step: ExtractionVisionStep;
  phase: "start" | "end";
};

export type VisionInferenceEvent = {
  pageIndex: number;
  step: ExtractionVisionStep;
  inference: "waiting" | "generating";
};

function pngToDataUrl(pngBytes: Uint8Array): string {
  const chunk = 8192;
  let binary = "";
  for (let i = 0; i < pngBytes.length; i += chunk) {
    const sub = pngBytes.subarray(i, i + chunk);
    for (let j = 0; j < sub.length; j++) {
      binary += String.fromCharCode(sub[j]);
    }
  }
  return `data:image/png;base64,${btoa(binary)}`;
}

function stripMarkdownJsonFence(text: string): string {
  let s = text.trim();
  const open = /^```(?:json)?\s*\r?\n?/i;
  const m = s.match(open);
  if (m && m.index === 0) s = s.slice(m[0].length);
  if (s.trimEnd().endsWith("```")) s = s.trimEnd().slice(0, -3).trimEnd();
  return s.trim();
}

function extractBalancedJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  let quote = "";
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === quote) inStr = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = true;
      quote = ch;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function parseJsonFromModelOutput(content: string | null): Record<string, unknown> | null {
  if (!content || !String(content).trim()) return null;
  const raw = String(content).trim();
  const candidates = [stripMarkdownJsonFence(raw), raw];
  for (const cand of candidates) {
    for (const chunk of [cand, extractBalancedJsonObject(cand) ?? ""]) {
      if (!chunk) continue;
      try {
        const out = JSON.parse(chunk) as unknown;
        if (out && typeof out === "object" && !Array.isArray(out)) {
          return out as Record<string, unknown>;
        }
      } catch {
        /* try next */
      }
    }
  }
  return null;
}

function parseJsonContent(content: string | null): Record<string, unknown> | null {
  return parseJsonFromModelOutput(content);
}

function stemOnlyContinuationSet(s: Record<string, unknown>): boolean {
  if (!s.continues_on_next_page) return false;
  const ct = String(s.context_text ?? "").trim();
  const stems = s.shared_stems;
  const hasStems =
    Array.isArray(stems) &&
    stems.some(
      (x) => x && typeof x === "object" && String((x as Record<string, unknown>).text ?? "").trim()
    );
  return Boolean(ct || hasStems);
}

const FULL_SCHEMA_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "page_extraction",
    strict: false,
    schema: {
      type: "object",
      properties: {
        regions: { type: "array" },
        sets: { type: "array" },
      },
      required: ["regions", "sets"],
    },
  },
} as const;

const LAYOUT_SCHEMA_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "page_layout",
    strict: false,
    schema: {
      type: "object",
      properties: { regions: { type: "array" } },
      required: ["regions"],
    },
  },
} as const;

function validatePagePayload(data: Record<string, unknown>): string[] {
  const issues: string[] = [];
  const regions = data.regions;
  const sets = data.sets;
  if (!Array.isArray(regions)) issues.push('"regions" must be an array.');
  if (!Array.isArray(sets)) issues.push('"sets" must be an array.');
  if (Array.isArray(sets)) {
    sets.forEach((s, si) => {
      if (!s || typeof s !== "object") {
        issues.push(`sets[${si}] is not an object.`);
        return;
      }
      const sd = s as Record<string, unknown>;
      const qs = sd.questions;
      if (!Array.isArray(qs) || qs.length === 0) {
        if (stemOnlyContinuationSet(sd)) return;
        issues.push(`sets[${si}] has no questions array or it is empty.`);
        return;
      }
      qs.forEach((q, qi) => {
        if (!q || typeof q !== "object") {
          issues.push(`sets[${si}].questions[${qi}] invalid.`);
          return;
        }
        const qq = q as Record<string, unknown>;
        if (qq.type === "mcq") {
          const opts = qq.options;
          if (!Array.isArray(opts) || opts.length < 2) {
            issues.push(
              `sets[${si}] Q${qq.question_index ?? qi} MCQ needs at least 2 options.`
            );
          }
        }
      });
    });
  }
  return issues;
}

function mergeLayoutIntoFull(
  layout: Record<string, unknown>,
  full: Record<string, unknown>
): Record<string, unknown> {
  const regions = layout.regions;
  if (Array.isArray(regions) && regions.length > 0) {
    const out = { ...full };
    out.regions = regions;
    if (!Array.isArray(out.sets)) out.sets = Array.isArray(full.sets) ? full.sets : [];
    return out;
  }
  return full;
}

async function chat(
  ctx: {
    baseUrl: string;
    model: string;
    useJsonSchema: boolean;
    imageDetail: "low" | "high";
    signal?: AbortSignal;
  },
  system: string,
  userText: string,
  dataUrl: string,
  responseFormat: { type: string; json_schema?: unknown },
  visionMeta: {
    pageIndex: number;
    step: ExtractionVisionStep;
    onVisionActivity?: (ev: VisionActivityEvent) => void;
    onInferencePhase?: (ev: VisionInferenceEvent) => void;
    useInferenceStream: boolean;
  }
): Promise<Record<string, unknown> | null> {
  const messages: ChatMessage[] = [
    { role: "system", content: system },
    {
      role: "user",
      content: [
        { type: "text", text: userText },
        { type: "image_url", image_url: { url: dataUrl, detail: ctx.imageDetail } },
      ],
    },
  ];
  const { pageIndex, step, onVisionActivity, onInferencePhase, useInferenceStream } = visionMeta;

  const runOnce = async (rf: { type: string; json_schema?: unknown }) => {
    onInferencePhase?.({ pageIndex, step, inference: "waiting" });
    return ollamaChatCompletion({
      baseUrl: ctx.baseUrl,
      model: ctx.model,
      messages,
      temperature: 0.1,
      responseFormat: rf,
      signal: ctx.signal,
      stream: useInferenceStream,
      onFirstToken: useInferenceStream
        ? () => onInferencePhase?.({ pageIndex, step, inference: "generating" })
        : undefined,
    });
  };

  onVisionActivity?.({ pageIndex, step, phase: "start" });
  try {
    try {
      const { content } = await runOnce(
        ctx.useJsonSchema ? responseFormat : { type: "json_object" }
      );
      return parseJsonContent(content);
    } catch (e) {
      if (ctx.useJsonSchema && responseFormat.type === "json_schema") {
        onInferencePhase?.({ pageIndex, step, inference: "waiting" });
        const { content } = await runOnce({ type: "json_object" });
        return parseJsonContent(content);
      }
      throw e;
    }
  } finally {
    onVisionActivity?.({ pageIndex, step, phase: "end" });
  }
}

async function chatFix(
  ctx: {
    baseUrl: string;
    model: string;
    imageDetail: "low" | "high";
    signal?: AbortSignal;
  },
  pageIndex: number,
  issues: string[],
  previous: Record<string, unknown>,
  dataUrl: string,
  visionMeta: {
    pageIndex: number;
    step: ExtractionVisionStep;
    onVisionActivity?: (ev: VisionActivityEvent) => void;
    onInferencePhase?: (ev: VisionInferenceEvent) => void;
    useInferenceStream: boolean;
  }
): Promise<Record<string, unknown> | null> {
  const user = fixOutputUser(
    pageIndex,
    issues,
    JSON.stringify(previous, null, 0)
  );
  const messages: ChatMessage[] = [
    { role: "system", content: FIX_OUTPUT_SYSTEM },
    {
      role: "user",
      content: [
        { type: "text", text: user },
        { type: "image_url", image_url: { url: dataUrl, detail: ctx.imageDetail } },
      ],
    },
  ];
  const { onVisionActivity, onInferencePhase, useInferenceStream, step } = visionMeta;
  onVisionActivity?.({ pageIndex: visionMeta.pageIndex, step, phase: "start" });
  onInferencePhase?.({ pageIndex: visionMeta.pageIndex, step, inference: "waiting" });
  try {
    const { content } = await ollamaChatCompletion({
      baseUrl: ctx.baseUrl,
      model: ctx.model,
      messages,
      temperature: 0.1,
      responseFormat: { type: "json_object" },
      signal: ctx.signal,
      stream: useInferenceStream,
      onFirstToken: useInferenceStream
        ? () =>
            onInferencePhase?.({
              pageIndex: visionMeta.pageIndex,
              step,
              inference: "generating",
            })
        : undefined,
    });
    return parseJsonContent(content);
  } catch {
    return null;
  } finally {
    onVisionActivity?.({ pageIndex: visionMeta.pageIndex, step, phase: "end" });
  }
}

export async function extractPageLocal(params: {
  pageIndex: number;
  pngBytes: Uint8Array;
  baseUrl: string;
  model: string;
  useJsonSchema: boolean;
  /** OpenAI-style vision detail; `low` reduces tokens/RAM vs `high`. */
  imageDetail?: "low" | "high";
  pdfPageText?: string | null;
  twoStage: boolean;
  layoutOnly: boolean;
  signal?: AbortSignal;
  /** Fires after each finished Ollama call (layout / main / fix) so the UI can advance during long inference. */
  onVisionSubstep?: () => void;
  onVisionActivity?: (ev: VisionActivityEvent) => void;
  onInferencePhase?: (ev: VisionInferenceEvent) => void;
  /** When true (e.g. debug UI), use streaming to detect first token vs waiting. */
  useInferenceStream?: boolean;
}): Promise<{ data: Record<string, unknown>; warnings: string[] }> {
  const warnings: string[] = [];
  const dataUrl = pngToDataUrl(params.pngBytes);
  const imageDetail = params.imageDetail ?? "low";
  const useInferenceStream = params.useInferenceStream === true;
  const ctx = {
    baseUrl: params.baseUrl,
    model: params.model,
    useJsonSchema: params.useJsonSchema,
    imageDetail,
    signal: params.signal,
  };

  const vm = (step: ExtractionVisionStep) => ({
    pageIndex: params.pageIndex,
    step,
    onVisionActivity: params.onVisionActivity,
    onInferencePhase: params.onInferencePhase,
    useInferenceStream,
  });

  if (params.layoutOnly) {
    try {
      const layoutJson = await chat(
        ctx,
        LAYOUT_ONLY_SYSTEM,
        layoutOnlyUser(params.pageIndex),
        dataUrl,
        LAYOUT_SCHEMA_FORMAT,
        vm("layout_only")
      );
      params.onVisionSubstep?.();
      let regions: unknown[] = [];
      if (layoutJson && Array.isArray(layoutJson.regions)) {
        regions = layoutJson.regions;
      }
      return { data: { regions, sets: [] }, warnings };
    } catch (e) {
      warnings.push(
        `Page ${params.pageIndex}: layout-only scan failed (${e instanceof Error ? e.message : String(e)}).`
      );
      return { data: { regions: [], sets: [] }, warnings };
    }
  }

  let layoutJson: Record<string, unknown> | null = null;
  if (params.twoStage) {
    try {
      layoutJson = await chat(
        ctx,
        LAYOUT_ONLY_SYSTEM,
        layoutOnlyUser(params.pageIndex),
        dataUrl,
        LAYOUT_SCHEMA_FORMAT,
        vm("layout")
      );
      if (layoutJson && !Array.isArray(layoutJson.regions)) layoutJson = null;
    } catch (e) {
      warnings.push(
        `Page ${params.pageIndex}: layout stage failed (${e instanceof Error ? e.message : String(e)}); using single-stage.`
      );
      layoutJson = null;
    }
    params.onVisionSubstep?.();
  }

  const hintParts: string[] = [];
  if (params.pdfPageText?.trim()) {
    hintParts.push(
      "Embedded PDF text for this page (may have ordering gaps; trust the image if they disagree):\n" +
        params.pdfPageText.trim().slice(0, 8000)
    );
  }
  if (params.twoStage && layoutJson && Array.isArray(layoutJson.regions)) {
    hintParts.push(
      "Layout pass region boxes (JSON). Refine text and question structure; keep or adjust boxes as needed:\n" +
        JSON.stringify(layoutJson.regions).slice(0, 12000)
    );
  }
  let hintBlock = hintParts.length ? hintParts.join("\n\n") : "";
  if (hintBlock) hintBlock = hintBlock + "\n\n";

  const userFull = pageExtractionUser(params.pageIndex, hintBlock);

  let data: Record<string, unknown> | null;
  try {
    data = await chat(
      ctx,
      PAGE_EXTRACTION_SYSTEM,
      userFull,
      dataUrl,
      FULL_SCHEMA_FORMAT,
      vm("extract")
    );
    params.onVisionSubstep?.();
  } catch (e) {
    throw new Error(
      `Vision model error on page ${params.pageIndex}: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  if (!data) {
    warnings.push(
      `Page ${params.pageIndex}: model returned empty or non-JSON output — try high-accuracy mode or a smaller page range.`
    );
    data = { regions: [], sets: [] };
  } else {
    if (params.twoStage && layoutJson) {
      data = mergeLayoutIntoFull(layoutJson, data);
    }
    if (!Array.isArray(data.regions)) data.regions = [];
    if (!Array.isArray(data.sets)) data.sets = [];

    const trivialPng = params.pngBytes.length < 8000;
    const sets = data.sets as unknown[];
    if (sets.length === 0 && !trivialPng) {
      if (params.pageIndex === 0) {
        warnings.push(
          `Page ${params.pageIndex}: no sets extracted. If this page is passage-only (MCQs on the next page), enable two-stage extraction; the model should return one set with context_text, questions:[], and continues_on_next_page:true.`
        );
      } else {
        warnings.push(
          `Page ${params.pageIndex}: no question sets extracted — check scan quality or enable two-stage / high accuracy.`
        );
      }
    }

    const issues = validatePagePayload(data);
    if (issues.length) {
      const fixed = await chatFix(
        {
          baseUrl: params.baseUrl,
          model: params.model,
          imageDetail,
          signal: params.signal,
        },
        params.pageIndex,
        issues,
        data,
        dataUrl,
        vm("fix")
      );
      params.onVisionSubstep?.();
      if (fixed && Array.isArray(fixed.sets)) {
        data = fixed;
      } else {
        warnings.push(
          `Page ${params.pageIndex}: validation issues remain after auto-retry: ${issues.slice(0, 3).join("; ")}`
        );
      }
    }
  }

  return { data, warnings };
}
