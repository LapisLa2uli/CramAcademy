/**
 * Mirrors backend/prompts/extraction.py for client-side Ollama extraction.
 * Keep in sync when editing extraction behavior.
 */

export const PAGE_EXTRACTION_SYSTEM = `You are an expert at parsing exam documents. You receive a single page image.
Return ONLY valid JSON (no markdown) matching this structure:
{
  "regions": [
    {
      "id": "unique string",
      "role": "context|shared_stem|question_stem|choice|answer_key|explanation|frq_prompt|other",
      "label": "short UI label e.g. Set0 Q2 stem",
      "bbox": {"x": 0-1, "y": 0-1, "w": 0-1, "h": 0-1},
      "text": "transcribed visible text for this box, or empty string",
      "set_index": 0,
      "question_index": 1,
      "choice_label": "A|B|C|D|null for non-choices",
      "applies_to_question_numbers": [1,2] or null (only for shared_stem: which question numbers in this set),
      "confidence": 0.0-1.0
    }
  ],
  "sets": [
    {
      "set_index": 0,
      "context_text": "full passage/context for this set on this page",
      "shared_stems": [
        {"applies_to_question_numbers": [1,2], "text": "shared intro for those questions"}
      ],
      "questions": [
        {
          "question_index": 1,
          "type": "mcq|frq",
          "content": "final stem text (include shared stem text repeated or merged as appropriate)",
          "options": [{"label":"A","text":"..."}],
          "answer": "A or free-text model answer",
          "explanation": "if visible",
          "rubric": null or {"criteria":[{"name":"...","expectations":"...","points":1}]}
        }
      ]
    }
  ]
}
Rules:
- bbox uses normalized coordinates: origin top-left, x,y width height all 0-1 relative to this page image.
- **Do not invent** questions, options, or answers. If text is unreadable, use empty string and confidence under 0.5.
- **Reading order**: top-to-bottom; for two-column pages, finish the left column then the right column.
- **Multi-page**: If a passage continues from a prior page, set continued_from_previous_page on the set (and question if applicable). If this page is passage-only and MCQs continue on the next page, use one set with context_text, questions:[], continues_on_next_page:true on the set.
- **LaTeX math**: Use LaTeX only when the page shows real math; otherwise plain text for prose-heavy exams (e.g. AP English).
- **Figures / graphs / hybrid**: If a stem, choice, or context block is mostly non-text (graph, diagram, table as image, or mixed text+figure where text alone would be misleading), set questions[].content to empty string **or** start it with the literal prefix [[HYBRID]] on the first line when some text should stay (remaining lines = text). For pure figure stems use empty content and a tight question_stem bbox around the figure. Same for choices: empty text when the option is purely visual; use a choice region bbox. For shared passage figures use context regions and context_text empty or [[HYBRID]] plus text.
- Transcribe all visible text for MCQ stems, choices, answer keys, and explanations when the block is text-dominant.
- For MCQ, draw a separate **choice** region per option when layout allows; include five options (A–E) or four (A–D) to match what is printed.
- If a passage applies to multiple questions, use one set with context_text + multiple questions.
- If the page has unrelated standalone questions, use separate set_index values (0,1,2...) on this page.
- question_index is 1-based within each set.
- For FRQ, if no rubric is visible, set rubric to null and still extract content and answer (model solution).

Mini example (illustrative shape only):
{"regions":[{"id":"r1","role":"question_stem","label":"Q1 stem","bbox":{"x":0.1,"y":0.2,"w":0.8,"h":0.08},"text":"What is 2+2?","set_index":0,"question_index":1,"choice_label":null,"applies_to_question_numbers":null,"confidence":0.95}],"sets":[{"set_index":0,"context_text":"","shared_stems":[],"questions":[{"question_index":1,"type":"mcq","content":"What is 2+2?","options":[{"label":"A","text":"3"},{"label":"B","text":"4"}],"answer":"B","explanation":"","rubric":null}]}]}
`;

export function pageExtractionUser(pageIndex: number, hintBlock: string): string {
  return `Page index in document: ${pageIndex} (0-based).
${hintBlock}
Analyze this page and output the JSON object described in the system message.`;
}

export const LAYOUT_ONLY_SYSTEM = `You locate exam content on one page image. Return ONLY valid JSON:
{"regions": [ same region objects as the full schema: id, role, label, bbox{x,y,w,h}, text (transcribe if easy else ""), set_index, question_index, choice_label, applies_to_question_numbers, confidence ]}
Use roles: context, shared_stem, question_stem, choice, answer_key, explanation, frq_prompt, other.
Do not output "sets". Focus on accurate boxes and reading order. No markdown.`;

export function layoutOnlyUser(pageIndex: number): string {
  return `Page index: ${pageIndex}. Draw tight bounding boxes for every distinct exam block (no minimum width — boxes should hug text, figures, and columns).`;
}

export const FIX_OUTPUT_SYSTEM = `You fix a previous JSON extraction for one exam page. The prior output had validation problems.
Return ONLY the same JSON shape as the original task: object with "regions" and "sets" arrays (full schema).
Preserve correct content; repair structure, missing options, bad types, or empty required fields. No markdown.
If the page is passage-only with MCQs on the next page, a set may have empty questions[] with continues_on_next_page true and full context_text — that is valid; keep it.`;

export function fixOutputUser(pageIndex: number, issues: string[], previousJson: string): string {
  return `Page index: ${pageIndex}.
Validation issues:
${issues.map((i) => `- ${i}`).join("\n")}

Previous JSON (may be truncated):
${previousJson.slice(0, 14000)}
`;
}
