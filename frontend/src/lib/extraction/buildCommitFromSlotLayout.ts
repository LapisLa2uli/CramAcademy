import type {
  ExtractionCommitBody,
  ExtractionNormRect,
  ExtractionPage,
  ExtractionRegion,
} from "@/types";
import { uploadQuestionImage } from "@/lib/questionImageUpload";
import { compositePngBlobsVertical } from "@/lib/pdf/compositeContextCrops";
import { cropNormRectToPngBlob } from "./cropExtractionImage";
import type { LayoutSetTemplate } from "./slotLayoutTypes";
import { choiceLabel } from "./slotLayoutTypes";
import { manualAnswerKey } from "./slotLayoutTypes";

function latexInText(s: string | null | undefined): boolean {
  if (!s) return false;
  return (
    /\$[^$\n]+\$/.test(s) ||
    /\\\([^)]+\\\)/.test(s) ||
    /\$\$[\s\S]+?\$\$/.test(s) ||
    /\\\[[\s\S]+?\\\]/.test(s)
  );
}

function bboxOf(
  r: ExtractionRegion,
  overrides: Record<string, ExtractionNormRect>
): ExtractionNormRect {
  return overrides[r.id] ?? r.bbox;
}

function findRegion(
  pages: ExtractionPage[],
  regionId: string
): { page: ExtractionPage; region: ExtractionRegion } | null {
  for (const page of pages) {
    const region = page.regions.find((x) => x.id === regionId);
    if (region) return { page, region };
  }
  return null;
}

async function regionToTextOrImage(
  userId: string,
  page: ExtractionPage,
  region: ExtractionRegion,
  bboxOverrides: Record<string, ExtractionNormRect>,
  fileBase: string
): Promise<{ text: string; imageUrl?: string }> {
  const t = (region.text || "").trim();
  if (t) {
    return { text: t };
  }
  const bb = bboxOf(region, bboxOverrides);
  const blob = await cropNormRectToPngBlob(
    page.image_base64,
    bb,
    page.width_px,
    page.height_px
  );
  const file = new File([blob], `${fileBase}.png`, { type: "image/png" });
  const imageUrl = await uploadQuestionImage(userId, file);
  return { text: "", imageUrl };
}

export function validateLayoutCommit(
  templates: LayoutSetTemplate[],
  assignments: Record<string, string | null>,
  manualAnswers: Record<string, string>
): string | null {
  if (templates.length === 0) {
    return "Add at least one question set or single question.";
  }
  for (const t of templates) {
    for (let qi = 0; qi < t.questions.length; qi++) {
      const qn = qi + 1;
      const stemId = `${t.id}-q${qn}-stem`;
      if (!assignments[stemId]) {
        return `Fill Q${qn} stem (set ${templates.indexOf(t) + 1}).`;
      }
      const q = t.questions[qi];
      if (q.choiceCount >= 2) {
        for (let k = 0; k < q.choiceCount; k++) {
          const cid = `${t.id}-q${qn}-c${k}`;
          if (!assignments[cid]) {
            return `Fill Q${qn} choice ${choiceLabel(k)} (set ${templates.indexOf(t) + 1}).`;
          }
        }
      }
      const ansKey = manualAnswerKey(t.id, qn, "answer");
      const ansSlot = `${t.id}-q${qn}-ans`;
      const fromSlot = assignments[ansSlot];
      const typed = (manualAnswers[ansKey] || "").trim();
      if (!fromSlot && !typed) {
        return `Enter or drop an answer for Q${qn} (set ${templates.indexOf(t) + 1}).`;
      }
    }
  }
  return null;
}

/** Assign region to at most one slot: clear other slots using same regionId. */
export function assignRegionToSlot(
  assignments: Record<string, string | null>,
  slotId: string,
  regionId: string
): Record<string, string | null> {
  const next = { ...assignments };
  for (const k of Object.keys(next)) {
    if (next[k] === regionId) next[k] = null;
  }
  next[slotId] = regionId;
  return next;
}

export async function buildCommitFromSlotLayout(params: {
  userId: string;
  pages: ExtractionPage[];
  templates: LayoutSetTemplate[];
  assignments: Record<string, string | null>;
  manualAnswers: Record<string, string>;
  bboxOverrides: Record<string, ExtractionNormRect>;
  subject: string;
  subject_id?: string | null;
  course_level?: string | null;
  grade_level?: number | null;
  tags: string[];
}): Promise<ExtractionCommitBody> {
  const {
    userId,
    pages,
    templates,
    assignments,
    manualAnswers,
    bboxOverrides,
    subject,
    subject_id,
    course_level,
    grade_level,
    tags,
  } = params;

  const setsOut: ExtractionCommitBody["sets"] = [];

  for (const t of templates) {
    const contextBlobs: Blob[] = [];
    const contextTexts: string[] = [];
    for (let c = 0; c < t.contextSlotCount; c++) {
      const sid = `${t.id}-ctx-${c}`;
      const rid = assignments[sid];
      if (!rid) continue;
      const found = findRegion(pages, rid);
      if (!found) continue;
      const { page, region } = found;
      const tx = (region.text || "").trim();
      if (tx) {
        contextTexts.push(tx);
      } else {
        const bb = bboxOf(region, bboxOverrides);
        contextBlobs.push(
          await cropNormRectToPngBlob(
            page.image_base64,
            bb,
            page.width_px,
            page.height_px
          )
        );
      }
    }

    let context_image_url: string | undefined;
    if (contextBlobs.length > 0) {
      const composite =
        contextBlobs.length === 1 ? contextBlobs[0] : await compositePngBlobsVertical(contextBlobs);
      const file = new File([composite], "context.png", { type: "image/png" });
      context_image_url = await uploadQuestionImage(userId, file);
    }
    const context_text = contextTexts.join("\n\n").trim();

    const questions: ExtractionCommitBody["sets"][0]["questions"] = [];

    for (let qi = 0; qi < t.questions.length; qi++) {
      const qn = qi + 1;
      const spec = t.questions[qi];
      const stemRid = assignments[`${t.id}-q${qn}-stem`]!;
      const stemFound = findRegion(pages, stemRid);
      if (!stemFound) {
        throw new Error(`Missing region for Q${qn} stem.`);
      }
      const stemRes = await regionToTextOrImage(
        userId,
        stemFound.page,
        stemFound.region,
        bboxOverrides,
        `stem-${t.id}-q${qn}`
      );
      const content =
        stemRes.text.trim() ||
        (stemRes.imageUrl ? "(see question image)" : "");
      const question_image_url = stemRes.imageUrl;

      const isMcq = spec.choiceCount >= 2;
      let options: { label: string; text: string; image_url?: string }[] | undefined;
      if (isMcq) {
        options = [];
        for (let k = 0; k < spec.choiceCount; k++) {
          const cid = `${t.id}-q${qn}-c${k}`;
          const crid = assignments[cid]!;
          const cf = findRegion(pages, crid);
          if (!cf) {
            throw new Error(`Missing region for Q${qn} choice ${choiceLabel(k)}.`);
          }
          const cr = await regionToTextOrImage(
            userId,
            cf.page,
            cf.region,
            bboxOverrides,
            `choice-${t.id}-q${qn}-${k}`
          );
          options.push({
            label: choiceLabel(k),
            text: cr.text.trim(),
            ...(cr.imageUrl ? { image_url: cr.imageUrl } : {}),
          });
        }
      }

      const ansSlotRid = assignments[`${t.id}-q${qn}-ans`];
      let answer = (manualAnswers[manualAnswerKey(t.id, qn, "answer")] || "").trim();
      if (ansSlotRid) {
        const af = findRegion(pages, ansSlotRid);
        if (af) {
          const ar = await regionToTextOrImage(
            userId,
            af.page,
            af.region,
            bboxOverrides,
            `answer-${t.id}-q${qn}`
          );
          if (ar.text.trim()) {
            answer = ar.text.trim();
          }
        }
      }

      const expSlotRid = assignments[`${t.id}-q${qn}-exp`];
      let explanation: string | undefined =
        (manualAnswers[manualAnswerKey(t.id, qn, "exp")] || "").trim() || undefined;
      if (expSlotRid) {
        const ef = findRegion(pages, expSlotRid);
        if (ef) {
          const er = await regionToTextOrImage(
            userId,
            ef.page,
            ef.region,
            bboxOverrides,
            `exp-${t.id}-q${qn}`
          );
          if (er.text.trim()) {
            explanation = er.text.trim();
          }
        }
      }

      const latex_enabled =
        latexInText(content) ||
        latexInText(explanation) ||
        latexInText(context_text) ||
        (options || []).some((o) => latexInText(o.text));

      let rubric: Record<string, unknown> | undefined;
      if (!isMcq) {
        rubric = {
          criteria: [
            {
              name: "Response",
              expectations: answer
                ? `Full credit for a complete response consistent with: ${answer.slice(0, 800)}`
                : "Full credit for a complete, correct response.",
              points: 1,
            },
          ],
          max_score: 1,
        };
      }

      questions.push({
        type: isMcq ? "mcq" : "frq",
        content,
        ...(question_image_url ? { question_image_url } : {}),
        ...(options ? { options } : {}),
        answer,
        explanation,
        rubric,
        latex_enabled,
      });
    }

    setsOut.push({
      context_text: context_text || (context_image_url ? "" : ""),
      ...(context_image_url ? { context_image_url } : {}),
      questions,
    });
  }

  return {
    subject: subject.trim(),
    ...(subject_id ? { subject_id } : {}),
    ...(course_level ? { course_level } : {}),
    ...(grade_level != null ? { grade_level } : {}),
    tags,
    sets: setsOut,
  };
}
