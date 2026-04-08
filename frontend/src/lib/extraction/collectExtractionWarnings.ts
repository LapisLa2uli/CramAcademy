/** Port of backend/services/extraction/consistency.py collect_warnings */
import type { ExtractionSetDraft } from "@/types";

export function collectExtractionWarnings(sets: ExtractionSetDraft[]): string[] {
  const warnings: string[] = [];
  for (const s of sets) {
    for (const q of s.questions) {
      const bundle = [q.content, q.explanation ?? "", q.answer].filter(Boolean).join(" ");
      for (const rx of [/\bQ\s*(\d+)\b/gi, /\bquestion\s*(\d+)\b/gi]) {
        let m: RegExpExecArray | null;
        while ((m = rx.exec(bundle)) != null) {
          const mentioned = parseInt(m[1], 10);
          if (mentioned !== q.question_index) {
            warnings.push(
              `Set ${s.set_index} Q${q.question_index}: text references question ${mentioned} — verify mapping.`
            );
          }
        }
      }
    }
  }
  return warnings;
}
