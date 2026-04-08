import {
  FIX_OUTPUT_SYSTEM,
  LAYOUT_ONLY_SYSTEM,
  PAGE_EXTRACTION_SYSTEM,
  fixOutputUser,
  layoutOnlyUser,
  pageExtractionUser,
} from "@/lib/extraction/extractionPrompts";
import { ollamaChatCompletion, type ChatMessage } from "@/lib/extraction/ollamaOpenAI";

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

function parseJsonContent(content: string | null): Record<string, unknown> | null {
  if (!content) return null;
  try {
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
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
  responseFormat: { type: string; json_schema?: unknown }
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
  try {
    const { content } = await ollamaChatCompletion({
      baseUrl: ctx.baseUrl,
      model: ctx.model,
      messages,
      temperature: 0.1,
      responseFormat: ctx.useJsonSchema ? responseFormat : { type: "json_object" },
      signal: ctx.signal,
    });
    return parseJsonContent(content);
  } catch (e) {
    if (ctx.useJsonSchema && responseFormat.type === "json_schema") {
      const { content } = await ollamaChatCompletion({
        baseUrl: ctx.baseUrl,
        model: ctx.model,
        messages,
        temperature: 0.1,
        responseFormat: { type: "json_object" },
        signal: ctx.signal,
      });
      return parseJsonContent(content);
    }
    throw e;
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
  dataUrl: string
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
  try {
    const { content } = await ollamaChatCompletion({
      baseUrl: ctx.baseUrl,
      model: ctx.model,
      messages,
      temperature: 0.1,
      responseFormat: { type: "json_object" },
      signal: ctx.signal,
    });
    return parseJsonContent(content);
  } catch {
    return null;
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
}): Promise<{ data: Record<string, unknown>; warnings: string[] }> {
  const warnings: string[] = [];
  const dataUrl = pngToDataUrl(params.pngBytes);
  const imageDetail = params.imageDetail ?? "low";
  const ctx = {
    baseUrl: params.baseUrl,
    model: params.model,
    useJsonSchema: params.useJsonSchema,
    imageDetail,
    signal: params.signal,
  };

  if (params.layoutOnly) {
    try {
      const layoutJson = await chat(
        ctx,
        LAYOUT_ONLY_SYSTEM,
        layoutOnlyUser(params.pageIndex),
        dataUrl,
        LAYOUT_SCHEMA_FORMAT
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
        LAYOUT_SCHEMA_FORMAT
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
      FULL_SCHEMA_FORMAT
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
      warnings.push(
        `Page ${params.pageIndex}: no question sets extracted — check scan quality or enable two-stage / high accuracy.`
      );
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
        dataUrl
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
