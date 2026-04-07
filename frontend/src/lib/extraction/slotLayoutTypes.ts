/** One question row inside a user-built set template (layout-only flow). */
export interface LayoutQuestionSpec {
  /** 0 = free response (no choice slots); ≥2 = multiple choice with that many options. */
  choiceCount: number;
}

/** User-defined question set template with empty slots to fill via drag-drop. */
export interface LayoutSetTemplate {
  id: string;
  /** Number of passage/context drop zones (0 = none; multiple composite vertically on commit). */
  contextSlotCount: number;
  questions: LayoutQuestionSpec[];
}

export const REGION_DRAG_MIME = "application/x-cram-region-id";

export function choiceLabel(index: number): string {
  return String.fromCharCode(65 + index);
}

export function buildSlotsForSet(t: LayoutSetTemplate): { slotId: string; label: string }[] {
  const slots: { slotId: string; label: string }[] = [];
  for (let c = 0; c < t.contextSlotCount; c++) {
    slots.push({
      slotId: `${t.id}-ctx-${c}`,
      label: t.contextSlotCount <= 1 ? "Passage / context" : `Context ${c + 1}`,
    });
  }
  t.questions.forEach((q, qi) => {
    const qn = qi + 1;
    slots.push({ slotId: `${t.id}-q${qn}-stem`, label: `Q${qn} stem` });
    for (let k = 0; k < q.choiceCount; k++) {
      slots.push({
        slotId: `${t.id}-q${qn}-c${k}`,
        label: `Q${qn} ${choiceLabel(k)}`,
      });
    }
    slots.push({ slotId: `${t.id}-q${qn}-ans`, label: `Q${qn} answer` });
    slots.push({
      slotId: `${t.id}-q${qn}-exp`,
      label: `Q${qn} explanation (optional)`,
    });
  });
  return slots;
}

/** Remove assignments whose slot ids no longer exist for the given templates. */
export function pruneAssignments(
  templates: LayoutSetTemplate[],
  assignments: Record<string, string | null>
): Record<string, string | null> {
  const valid = new Set<string>();
  for (const t of templates) {
    for (const { slotId } of buildSlotsForSet(t)) {
      valid.add(slotId);
    }
  }
  const next: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(assignments)) {
    if (valid.has(k) && v) next[k] = v;
  }
  return next;
}

export function manualAnswerKey(templateId: string, questionOrdinal: number, kind: "answer" | "exp"): string {
  return `${templateId}-q${questionOrdinal}-${kind}`;
}
