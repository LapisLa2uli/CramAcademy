/**
 * Port of backend/services/extraction/normalize.py merge_page_results + helpers.
 */
import type {
  ExtractionNormRect,
  ExtractionPage,
  ExtractionQuestionDraft,
  ExtractionRegion,
  ExtractionRegionRole,
  ExtractionSetDraft,
} from "@/types";

function coerceInt(v: unknown, defaultVal: number): number {
  if (v == null) return defaultVal;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number" && !Number.isNaN(v)) return Math.trunc(v);
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return defaultVal;
    const n = parseInt(s, 10);
    return Number.isNaN(n) ? defaultVal : n;
  }
  return defaultVal;
}

function coerceOptionalInt(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number" && !Number.isNaN(v)) return Math.trunc(v);
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    const n = parseInt(s, 10);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

function coerceIntList(nums: unknown): number[] {
  if (!Array.isArray(nums)) return [];
  const out: number[] = [];
  for (const x of nums) {
    if (x == null) continue;
    const n = typeof x === "number" ? x : parseInt(String(x), 10);
    if (!Number.isNaN(n)) out.push(n);
  }
  return out;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function coerceFloat(v: unknown, defaultVal: number): number {
  if (v == null) return defaultVal;
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return defaultVal;
    const n = parseFloat(s);
    return Number.isNaN(n) ? defaultVal : n;
  }
  return defaultVal;
}

function normBBox(raw: Record<string, unknown> | null | undefined): ExtractionNormRect {
  if (!raw) return { x: 0, y: 0, w: 0.5, h: 0.1 };
  const x = clamp01(coerceFloat(raw.x, 0));
  const y = clamp01(coerceFloat(raw.y, 0));
  let w = coerceFloat(raw.w, 0.1);
  let h = coerceFloat(raw.h, 0.1);
  const min = 0.002;
  w = Math.max(min, Math.min(1 - x, w));
  h = Math.max(min, Math.min(1 - y, h));
  return { x, y, w, h };
}

const VALID_ROLES: ExtractionRegionRole[] = [
  "context",
  "shared_stem",
  "question_stem",
  "choice",
  "answer_key",
  "explanation",
  "frq_prompt",
  "other",
];

function parseRegions(
  pageIndex: number,
  rawRegions: unknown[],
  setIdMap: Map<number, number>
): ExtractionRegion[] {
  const out: ExtractionRegion[] = [];
  rawRegions.forEach((r, i) => {
    if (!r || typeof r !== "object") return;
    const row = r as Record<string, unknown>;
    const sid = coerceInt(row.set_index, 0);
    const gid = setIdMap.get(sid) ?? sid;
    let role = String(row.role ?? "other") as ExtractionRegionRole;
    if (!VALID_ROLES.includes(role)) role = "other";
    const qidx = row.question_index;
    const applies = row.applies_to_question_numbers;
    const cl = row.choice_label;
    out.push({
      id: String(row.id ?? `p${pageIndex}-r${i}`),
      page_index: pageIndex,
      role,
      label: String(row.label ?? role),
      bbox: normBBox(row.bbox as Record<string, unknown>),
      text: typeof row.text === "string" ? row.text : null,
      set_index: gid,
      question_index: coerceOptionalInt(qidx),
      choice_label:
        cl != null && cl !== "null" && typeof cl === "string" ? cl : null,
      applies_to_question_numbers: Array.isArray(applies)
        ? coerceIntList(applies)
        : null,
      confidence:
        row.confidence != null && typeof row.confidence === "number"
          ? row.confidence
          : null,
    });
  });
  return out;
}

function coerceBool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true" || s === "yes" || s === "1" || s === "t" || s === "y") return true;
  }
  return false;
}

function parseSet(
  raw: Record<string, unknown>,
  globalSetIndex: number,
  pageIndex: number
): ExtractionSetDraft {
  const qs: ExtractionQuestionDraft[] = [];
  for (const q of (raw.questions as unknown[]) ?? []) {
    if (!q || typeof q !== "object") continue;
    const qq = q as Record<string, unknown>;
    qs.push({
      question_index: coerceInt(qq.question_index, qs.length + 1),
      type: qq.type === "mcq" ? "mcq" : "frq",
      content: String(qq.content ?? ""),
      options: Array.isArray(qq.options) ? (qq.options as ExtractionQuestionDraft["options"]) : undefined,
      answer: String(qq.answer ?? ""),
      explanation: typeof qq.explanation === "string" ? qq.explanation : null,
      rubric: qq.rubric && typeof qq.rubric === "object" ? (qq.rubric as Record<string, unknown>) : null,
      continued_from_previous_page: coerceBool(qq.continued_from_previous_page),
      continues_on_next_page: coerceBool(qq.continues_on_next_page),
    });
  }
  const stems: ExtractionSetDraft["shared_stems"] = [];
  for (const s of (raw.shared_stems as unknown[]) ?? []) {
    if (!s || typeof s !== "object") continue;
    const ss = s as Record<string, unknown>;
    stems.push({
      applies_to_question_numbers: coerceIntList(ss.applies_to_question_numbers),
      text: String(ss.text ?? ""),
    });
  }
  return {
    set_index: globalSetIndex,
    context_text: String(raw.context_text ?? ""),
    shared_stems: stems,
    questions: qs,
    continued_from_previous_page: coerceBool(raw.continued_from_previous_page),
    continues_on_next_page: coerceBool(raw.continues_on_next_page),
    source_page_indices: [pageIndex],
  };
}

function bytesToBase64(pngBytes: Uint8Array): string {
  const chunk = 8192;
  let binary = "";
  for (let i = 0; i < pngBytes.length; i += chunk) {
    const sub = pngBytes.subarray(i, i + chunk);
    for (let j = 0; j < sub.length; j++) {
      binary += String.fromCharCode(sub[j]);
    }
  }
  return btoa(binary);
}

export type StitchEvent = {
  target_set_index: number;
  source_page_indices: number[];
  reason: string;
  question_bridge: boolean;
};

export function mergePageResults(
  pageResults: Array<{
    pageIndex: number;
    raw: Record<string, unknown>;
    pngBytes: Uint8Array;
    w: number;
    h: number;
  }>
): {
  pages: ExtractionPage[];
  sets: ExtractionSetDraft[];
  stitchEvents: StitchEvent[];
} {
  const allSets: ExtractionSetDraft[] = [];
  const pagesOut: ExtractionPage[] = [];
  const setsByPage = new Map<number, number[]>();

  for (const { pageIndex, raw, pngBytes, w, h } of pageResults) {
    const regionsRaw = Array.isArray(raw.regions) ? raw.regions : [];
    const setsRaw = Array.isArray(raw.sets) ? raw.sets : [];

    const setIdMap = new Map<number, number>();
    const pageSetGids: number[] = [];

    function ensureLocalSet(localSid: number): number {
      if (!setIdMap.has(localSid)) {
        const gid = allSets.length;
        setIdMap.set(localSid, gid);
        allSets.push({
          set_index: gid,
          context_text: "",
          shared_stems: [],
          questions: [],
          continued_from_previous_page: false,
          continues_on_next_page: false,
          source_page_indices: [pageIndex],
        });
        pageSetGids.push(gid);
      }
      return setIdMap.get(localSid)!;
    }

    for (const s of setsRaw) {
      if (!s || typeof s !== "object") continue;
      const sd = s as Record<string, unknown>;
      const local = coerceInt(sd.set_index, 0);
      const gid = ensureLocalSet(local);
      allSets[gid] = parseSet(sd, gid, pageIndex);
    }

    for (const r of regionsRaw) {
      if (r && typeof r === "object") {
        const rd = r as Record<string, unknown>;
        ensureLocalSet(coerceInt(rd.set_index, 0));
      }
    }

    const regions = parseRegions(pageIndex, regionsRaw, setIdMap);
    const b64 = bytesToBase64(pngBytes);
    pagesOut.push({
      page_index: pageIndex,
      width_px: w,
      height_px: h,
      image_base64: b64,
      regions,
    });
    setsByPage.set(pageIndex, pageSetGids);
  }

  const { sets: finalSets, events: stitchEvents } = stitchCrossPageSets(
    allSets,
    setsByPage
  );
  return { pages: pagesOut, sets: finalSets, stitchEvents };
}

/** Port of backend normalize._stitch_cross_page_sets. */
function stitchCrossPageSets(
  sets: ExtractionSetDraft[],
  setsByPage: Map<number, number[]>
): { sets: ExtractionSetDraft[]; events: StitchEvent[] } {
  const events: StitchEvent[] = [];
  if (sets.length === 0 || setsByPage.size < 2) {
    return { sets, events };
  }

  const pagesSorted = Array.from(setsByPage.keys()).sort((a, b) => a - b);
  const absorbed = new Set<number>();
  const redirect = new Map<number, number>();

  function resolve(gid: number): number {
    const seen: number[] = [];
    let cur = gid;
    while (redirect.has(cur)) {
      seen.push(cur);
      cur = redirect.get(cur)!;
    }
    for (const g of seen) redirect.set(g, cur);
    return cur;
  }

  for (let i = 1; i < pagesSorted.length; i++) {
    const prevPage = pagesSorted[i - 1];
    const curPage = pagesSorted[i];
    const prevGids = (setsByPage.get(prevPage) ?? []).filter(
      (g) => !absorbed.has(g)
    );
    const curGids = (setsByPage.get(curPage) ?? []).filter(
      (g) => !absorbed.has(g)
    );
    if (prevGids.length === 0 || curGids.length === 0) continue;

    const lastPrevGid = resolve(prevGids[prevGids.length - 1]);
    const firstCurGid = resolve(curGids[0]);
    if (lastPrevGid === firstCurGid) continue;

    const lastPrev = sets[lastPrevGid];
    const firstCur = sets[firstCurGid];
    if (
      !(
        lastPrev.continues_on_next_page ||
        firstCur.continued_from_previous_page
      )
    ) {
      continue;
    }

    const reasons: string[] = [];
    if (lastPrev.continues_on_next_page) reasons.push("prev.continues_on_next_page");
    if (firstCur.continued_from_previous_page)
      reasons.push("next.continued_from_previous_page");
    const questionBridge = Boolean(
      lastPrev.questions.length > 0 &&
        firstCur.questions.length > 0 &&
        (lastPrev.questions[lastPrev.questions.length - 1]
          ?.continues_on_next_page ||
          firstCur.questions[0]?.continued_from_previous_page)
    );
    const preMergePages = [...(lastPrev.source_page_indices ?? [])];

    mergeSetInto(lastPrev, firstCur);
    absorbed.add(firstCurGid);
    redirect.set(firstCurGid, lastPrevGid);

    const mergedPages = Array.from(
      new Set([...preMergePages, ...(firstCur.source_page_indices ?? [])])
    ).sort((a, b) => a - b);
    events.push({
      target_set_index: lastPrevGid,
      source_page_indices: mergedPages,
      reason: reasons.join(" + "),
      question_bridge: questionBridge,
    });
  }

  if (absorbed.size === 0) return { sets, events };

  const survivors: ExtractionSetDraft[] = [];
  const oldToNew = new Map<number, number>();
  sets.forEach((s, idx) => {
    if (absorbed.has(idx)) return;
    oldToNew.set(idx, survivors.length);
    survivors.push(s);
  });
  survivors.forEach((s, idx) => {
    s.set_index = idx;
  });
  for (const ev of events) {
    let finalOld = ev.target_set_index;
    while (redirect.has(finalOld)) finalOld = redirect.get(finalOld)!;
    ev.target_set_index = oldToNew.get(finalOld) ?? finalOld;
  }
  return { sets: survivors, events };
}

function mergeSetInto(dst: ExtractionSetDraft, src: ExtractionSetDraft): void {
  if (src.context_text) {
    dst.context_text = dst.context_text
      ? (dst.context_text.trimEnd() + " " + src.context_text.trimStart()).trim()
      : src.context_text;
  }

  const existing = new Set(
    dst.shared_stems.map(
      (s) => JSON.stringify(s.applies_to_question_numbers) + "|" + s.text
    )
  );
  for (const s of src.shared_stems) {
    const key = JSON.stringify(s.applies_to_question_numbers) + "|" + s.text;
    if (!existing.has(key)) {
      dst.shared_stems.push(s);
      existing.add(key);
    }
  }

  let srcQuestions = [...src.questions];
  if (
    srcQuestions.length > 0 &&
    dst.questions.length > 0 &&
    (srcQuestions[0].continued_from_previous_page ||
      dst.questions[dst.questions.length - 1].continues_on_next_page)
  ) {
    mergeQuestionInto(dst.questions[dst.questions.length - 1], srcQuestions[0]);
    srcQuestions = srcQuestions.slice(1);
  }

  let nextIndex =
    dst.questions.length > 0
      ? Math.max(...dst.questions.map((q) => q.question_index)) + 1
      : 1;
  for (const q of srcQuestions) {
    if (dst.questions.some((eq) => eq.question_index === q.question_index)) {
      q.question_index = nextIndex;
    }
    nextIndex = Math.max(nextIndex, q.question_index) + 1;
    dst.questions.push(q);
  }

  dst.continues_on_next_page = src.continues_on_next_page;
  const pageSet = new Set([
    ...(dst.source_page_indices ?? []),
    ...(src.source_page_indices ?? []),
  ]);
  dst.source_page_indices = Array.from(pageSet).sort((a, b) => a - b);
}

function mergeQuestionInto(
  dst: ExtractionQuestionDraft,
  src: ExtractionQuestionDraft
): void {
  if (src.content) {
    dst.content = dst.content
      ? (dst.content.trimEnd() + " " + src.content.trimStart()).trim()
      : src.content;
  }
  if (src.options && src.options.length > 0) {
    if (!dst.options || dst.options.length === 0) {
      dst.options = [...src.options];
    } else {
      const have = new Set(
        dst.options.map((o) =>
          o && typeof o === "object" ? String((o as Record<string, unknown>).label) : ""
        )
      );
      for (const o of src.options) {
        if (o && typeof o === "object") {
          const label = String((o as Record<string, unknown>).label);
          if (!have.has(label)) {
            dst.options.push(o);
            have.add(label);
          }
        }
      }
    }
  }
  if (src.answer && !dst.answer) dst.answer = src.answer;
  if (src.explanation) {
    dst.explanation = dst.explanation
      ? (dst.explanation.trimEnd() + " " + src.explanation.trimStart()).trim()
      : src.explanation;
  }
  if (src.rubric && !dst.rubric) dst.rubric = src.rubric;
  dst.continues_on_next_page = src.continues_on_next_page;
}
