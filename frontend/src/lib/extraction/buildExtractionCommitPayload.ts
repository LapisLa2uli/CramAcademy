import type {
  ExtractionAnalyzeResponse,
  ExtractionCommitBody,
  ExtractionNormRect,
  ExtractionRegion,
  ExtractionSetDraft,
} from "@/types";
import { uploadQuestionImage } from "@/lib/questionImageUpload";
import { compositePngBlobsVertical } from "@/lib/pdf/compositeContextCrops";
import { cropNormRectToPngBlob } from "./cropExtractionImage";

function bboxOf(
  r: ExtractionRegion,
  overrides: Record<string, ExtractionNormRect>
): ExtractionNormRect {
  return overrides[r.id] ?? r.bbox;
}

function stripHybridMarker(text: string): string {
  return text.replace(/^\s*\[\[HYBRID\]\]\s*/i, "").trim();
}

function latexInText(s: string | null | undefined): boolean {
  if (!s) return false;
  return (
    /\$[^$\n]+\$/.test(s) ||
    /\\\([^)]+\\\)/.test(s) ||
    /\$\$[\s\S]+?\$\$/.test(s) ||
    /\\\[[\s\S]+?\\\]/.test(s)
  );
}

function collectRegions(
  pages: ExtractionAnalyzeResponse["pages"],
  pred: (r: ExtractionRegion) => boolean
): { page: ExtractionAnalyzeResponse["pages"][0]; region: ExtractionRegion }[] {
  const out: { page: ExtractionAnalyzeResponse["pages"][0]; region: ExtractionRegion }[] = [];
  for (const p of pages) {
    for (const r of p.regions) {
      if (pred(r)) out.push({ page: p, region: r });
    }
  }
  return out;
}

export async function buildExtractionCommitPayload(params: {
  userId: string;
  data: ExtractionAnalyzeResponse;
  editableSets: ExtractionSetDraft[];
  bboxOverrides: Record<string, ExtractionNormRect>;
  subject: string;
  subject_id?: string | null;
  course_level?: string | null;
  grade_level?: number | null;
  tags: string[];
}): Promise<ExtractionCommitBody> {
  const {
    userId,
    data,
    editableSets,
    bboxOverrides,
    subject,
    subject_id,
    course_level,
    grade_level,
    tags,
  } = params;

  const pages = data.pages;
  const setsOut: ExtractionCommitBody["sets"] = [];

  for (const s of editableSets.filter((x) => x.questions.length > 0)) {
    const si = s.set_index;

    const contextRegs = collectRegions(
      pages,
      (r) => r.role === "context" && r.set_index === si
    ).sort((a, b) => {
      if (a.page.page_index !== b.page.page_index) {
        return a.page.page_index - b.page.page_index;
      }
      return a.region.bbox.y - b.region.bbox.y;
    });

    let context_image_url: string | undefined;
    if (contextRegs.length > 0) {
      const blobs: Blob[] = [];
      for (const { page, region } of contextRegs) {
        const bb = bboxOf(region, bboxOverrides);
        blobs.push(
          await cropNormRectToPngBlob(
            page.image_base64,
            bb,
            page.width_px,
            page.height_px
          )
        );
      }
      const composite =
        blobs.length === 1 ? blobs[0] : await compositePngBlobsVertical(blobs);
      const file = new File([composite], "context.png", { type: "image/png" });
      context_image_url = await uploadQuestionImage(userId, file);
    }

    const context_text_stripped = stripHybridMarker(s.context_text || "");

    const questions: ExtractionCommitBody["sets"][0]["questions"] = [];

    for (const q of s.questions) {
      const stems = collectRegions(
        pages,
        (r) =>
          r.role === "question_stem" &&
          r.set_index === si &&
          r.question_index === q.question_index
      );

      const rawContent = q.content || "";
      const hybrid = /^\s*\[\[HYBRID\]\]/i.test(rawContent);
      const strippedContent = stripHybridMarker(rawContent);
      const wantStemImage =
        stems.length > 0 &&
        (!strippedContent.trim() || hybrid);

      let question_image_url: string | undefined;
      if (wantStemImage) {
        const { page, region } = stems[0];
        const bb = bboxOf(region, bboxOverrides);
        const blob = await cropNormRectToPngBlob(
          page.image_base64,
          bb,
          page.width_px,
          page.height_px
        );
        const file = new File([blob], `stem-q${q.question_index}.png`, {
          type: "image/png",
        });
        question_image_url = await uploadQuestionImage(userId, file);
      }

      const finalContent =
        strippedContent.trim() ||
        (question_image_url ? "(see question image)" : "");

      let options = q.options;
      if (q.type === "mcq" && options) {
        const nextOpts = await Promise.all(
          options.map(async (opt) => {
            const label = opt.label?.toUpperCase().slice(0, 1) ?? "";
            if (opt.text?.trim()) {
              return { ...opt, label };
            }
            const choices = collectRegions(
              pages,
              (r) =>
                r.role === "choice" &&
                r.set_index === si &&
                r.question_index === q.question_index &&
                (r.choice_label?.toUpperCase() === label ||
                  r.label?.toUpperCase() === `CHOICE ${label}`)
            );
            if (choices.length === 0) {
              return { ...opt, label };
            }
            const { page, region } = choices[0];
            const bb = bboxOf(region, bboxOverrides);
            const blob = await cropNormRectToPngBlob(
              page.image_base64,
              bb,
              page.width_px,
              page.height_px
            );
            const file = new File([blob], `choice-${label}-q${q.question_index}.png`, {
              type: "image/png",
            });
            const image_url = await uploadQuestionImage(userId, file);
            return { label, text: opt.text || "", image_url };
          })
        );
        options = nextOpts;
      }

      let rubric = q.rubric ?? undefined;
      if (q.type === "frq" && !rubric) {
        rubric = {
          criteria: [
            {
              name: "Response",
              expectations: q.answer.trim()
                ? `Full credit for a complete response consistent with: ${q.answer.trim().slice(0, 800)}`
                : "Full credit for a complete, correct response.",
              points: 1,
            },
          ],
          max_score: 1,
        };
      }

      const latex_enabled =
        latexInText(finalContent) ||
        latexInText(q.explanation) ||
        latexInText(s.context_text) ||
        latexInText(context_text_stripped) ||
        (options || []).some((o) => latexInText(o.text));

      questions.push({
        type: q.type,
        content: finalContent,
        options: q.type === "mcq" ? options : undefined,
        answer: q.answer,
        explanation: q.explanation || undefined,
        rubric,
        latex_enabled,
        ...(question_image_url ? { question_image_url } : {}),
      } as ExtractionCommitBody["sets"][0]["questions"][0]);
    }

    setsOut.push({
      context_text: context_text_stripped || (context_image_url ? "" : s.context_text || ""),
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
