PAGE_EXTRACTION_SYSTEM = """You are an expert at parsing exam documents. You receive a single page image.
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
      "continued_from_previous_page": false,
      "continues_on_next_page": false,
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
          "rubric": null or {"criteria":[{"name":"...","expectations":"...","points":1}]},
          "continued_from_previous_page": false,
          "continues_on_next_page": false
        }
      ]
    }
  ]
}
Rules:
- bbox uses normalized coordinates: origin top-left, x,y width height all 0-1 relative to this page image.
- **Do not invent** questions, options, or answers. If text is unreadable, use empty string and confidence under 0.5.

- **Reading order — CRITICAL for multi-column pages**:
  Many exam pages use a TWO-COLUMN layout. Before extracting, first decide whether the page is single-column or multi-column by looking at whether text blocks, question numbers, and choices line up in two distinct vertical bands separated by a visible gap or vertical rule.
  * Single-column: read strictly top-to-bottom.
  * Two-column: read the ENTIRE left column top-to-bottom FIRST, then the entire right column top-to-bottom. Never interleave columns by y-coordinate — a question halfway down the right column comes AFTER every question in the left column, even ones lower on the page. Question numbering almost always continues from the bottom of the left column to the top of the right column.
  * If in doubt, check question numbers: if Q1 is top-left and Q2 is directly below it but Q(N/2+1) starts again at the top-right, it IS a two-column layout.
  You MUST extract EVERY question visible on the page, including all questions in the right column. Do not stop after the left column. Missing right-column questions is a serious error.

- **LaTeX math — STRICT when math appears**: Whenever the page shows mathematical notation (equations, formulas, scientific symbols), ALL such expressions MUST be written as LaTeX, never as Unicode symbols.
  * Inline math: wrap with `$...$` (e.g. `$x^2 + 1$`, `$\\pi r^2$`, `$\\frac{a}{b}$`).
  * Display math: wrap with `$$...$$` for standalone equations.
  * Convert every Unicode math symbol to its LaTeX command. NEVER emit raw Unicode math. Examples of required conversions:
      π → \\pi    θ → \\theta    α → \\alpha    β → \\beta    λ → \\lambda    μ → \\mu    σ → \\sigma    Δ → \\Delta    Σ → \\Sigma    Ω → \\Omega    ∞ → \\infty
      ≤ → \\leq   ≥ → \\geq   ≠ → \\neq   ≈ → \\approx   ± → \\pm   × → \\times   ÷ → \\div   · → \\cdot   ∘ → \\circ
      → → \\to   ⇒ → \\Rightarrow   ⇔ → \\Leftrightarrow   ∈ → \\in   ∉ → \\notin   ⊂ → \\subset   ⊆ → \\subseteq   ∪ → \\cup   ∩ → \\cap   ∅ → \\emptyset
      ∑ → \\sum   ∏ → \\prod   ∫ → \\int   ∂ → \\partial   ∇ → \\nabla   √ → \\sqrt{...}   ∛ → \\sqrt[3]{...}
      ² → ^2      ³ → ^3      ⁿ → ^n      ₁ → _1    ₂ → _2    ₙ → _n
      ∥ → \\parallel   ⊥ → \\perp   ∠ → \\angle   ° → ^\\circ
  * Fractions: write `\\frac{numerator}{denominator}`, not stacked unicode or ASCII `a/b` when a proper fraction is shown.
  * Exponents/subscripts: use `^{}` and `_{}` (e.g. `x^{2}`, `a_{n+1}`), never Unicode superscripts/subscripts.
  * Square roots: `\\sqrt{x}` or `\\sqrt[n]{x}`, never `√x`.
  * Integrals, sums, limits: use `\\int`, `\\sum`, `\\lim`, with `_{}` and `^{}` for bounds.
  * Greek letters in variable names or equations: always use the LaTeX command.
  * Apply this rule everywhere: `context_text`, `shared_stems[].text`, `questions[].content`, `options[].text`, `answer`, `explanation`, and region `text`.
  * Do not invent math that is not visible on the page.

- **Multi-page problem sets**: If a passage, shared stem, or question clearly continues from the previous page (e.g. page starts mid-sentence, question number is higher than the first question on the page with no header, or the answer choices appear without a visible stem), set `continued_from_previous_page: true` on BOTH the containing set and the specific continuation question. If a passage or question clearly runs past the bottom of this page (e.g. question stem ends mid-sentence, answer choices missing, or a shared passage is clearly unfinished), set `continues_on_next_page: true`. Still transcribe whatever text IS visible on this page — do not leave content blank because it is partial. Downstream code will stitch continuations together.

- **Passage-only page then MCQs on the next page (AP English and similar)**:
  If this page shows **only** a reading passage / stimulus and **no** numbered multiple-choice items (no lines like `1.` with `(A)`…`(E)` choices on this page), output **exactly one** `set` with: `context_text` = full passage text you can read; `shared_stems` if a printed block applies (e.g. “Questions 1–n refer…”); **`questions`: []** (empty array); **`continues_on_next_page`: true** on that **set**. Use `regions` with role `context` for passage blocks as usual.
  On the **next** page where the MCQs appear for that passage, output a **set** with **`continued_from_previous_page`: true**, fill `questions` with stems, options, and printed numbers, and **do not repeat** the full passage in `context_text` unless a new passage begins there.

- **Humanities / prose-heavy exams (e.g. AP English Language)**: Prioritize accurate **plain-text** transcription of rhetoric and reading questions. Apply the **LaTeX math** rules below **only** when the page actually shows mathematical notation or symbols that need it; ordinary prose and line references do not need dollar signs.

- **Figures / graphs / hybrid**: If a stem, choice, or context block is mostly non-text (graph, diagram, table as image, or mixed text+figure where text alone would be misleading), set `questions[].content` to empty string **or** start it with the literal prefix `[[HYBRID]]` on the first line when some text should stay (remaining lines = text). For pure figure stems use empty `content` and a tight `question_stem` bbox around the figure. Same for choices: empty `text` when the option is purely visual; use a `choice` region bbox. For shared passage figures use `context` regions and `context_text` empty or `[[HYBRID]]` plus text.
- Transcribe all visible text for MCQ stems, choices, answer keys, and explanations when the block is text-dominant.
- For MCQ, draw a separate **choice** region per option when layout allows; include **five** options (A–E) when the exam uses five, or **four** (A–D) when only four are printed.
- If a passage applies to multiple questions, use one set with context_text + multiple questions.
- If the page has unrelated standalone questions, use separate set_index values (0,1,2...) on this page.
- question_index is 1-based within each set and should match the printed number on the page whenever one is visible.
- For FRQ, if no rubric is visible, set rubric to null and still extract content and answer (model solution).

Mini example (illustrative shape only):
{"regions":[{"id":"r1","role":"question_stem","label":"Q1 stem","bbox":{"x":0.1,"y":0.2,"w":0.8,"h":0.08},"text":"What is $2+2$?","set_index":0,"question_index":1,"choice_label":null,"applies_to_question_numbers":null,"confidence":0.95}],"sets":[{"set_index":0,"context_text":"","continued_from_previous_page":false,"continues_on_next_page":false,"shared_stems":[],"questions":[{"question_index":1,"type":"mcq","content":"What is $2+2$?","options":[{"label":"A","text":"$3$"},{"label":"B","text":"$4$"}],"answer":"B","explanation":"","rubric":null,"continued_from_previous_page":false,"continues_on_next_page":false}]}]}
"""

PAGE_EXTRACTION_USER = """Page index in document: {page_index} (0-based).
{hint_block}
Analyze this page and output the JSON object described in the system message.

Reminders:
- If this page has TWO COLUMNS, extract the full left column first and then the full right column. Do NOT stop after the left column.
- When the page has real math, use LaTeX (e.g. `$\\pi$`, `$x^{{2}}$`); otherwise plain text is fine for prose-only pages.
- If a question or passage is cut off at the top or bottom of the page, set the corresponding `continued_from_previous_page` / `continues_on_next_page` flag so it can be stitched with neighbouring pages."""

LAYOUT_ONLY_SYSTEM = """You locate exam content on one page image. Return ONLY valid JSON:
{"regions": [ same region objects as the full schema: id, role, label, bbox{x,y,w,h}, text (transcribe if easy else ""), set_index, question_index, choice_label, applies_to_question_numbers, confidence ]}
Use roles: context, shared_stem, question_stem, choice, answer_key, explanation, frq_prompt, other.
Do not output "sets". Focus on accurate boxes and reading order. No markdown.

If the page is laid out in two columns, assign reading order so that every block in the left column precedes every block in the right column. Do not interleave columns by y-coordinate."""

LAYOUT_ONLY_USER = """Page index: {page_index}. Draw tight bounding boxes for every distinct exam block (no minimum width — boxes should hug text, figures, and columns). If the page has two columns, cover BOTH columns completely; missing the right column is a serious error."""

FIX_OUTPUT_SYSTEM = """You fix a previous JSON extraction for one exam page. The prior output had validation problems.
Return ONLY the same JSON shape as the original task: object with "regions" and "sets" arrays (full schema).
Preserve correct content; repair structure, missing options, bad types, or empty required fields. No markdown.
If the page is passage-only with MCQs on the next page, a set may have empty questions[] with continues_on_next_page true and full context_text — that is valid; keep it.
All mathematical symbols in text fields must be LaTeX (e.g. `$\\pi$`, `$x^2$`), never raw Unicode, but only where math is actually shown."""

FIX_OUTPUT_USER = """Page index: {page_index}.
Validation issues:
{issues}

Previous JSON (may be truncated):
{previous_json}
"""


CROSS_PAGE_USER = """See system message."""


TEXT_ONLY_REORDER_SYSTEM = """You normalize OCR/text-layer extraction for exam pages.
You receive raw text that may be out of order due to multi-column PDF extraction.
Return ONLY plain text in corrected reading order.
Rules:
- If text appears two-column, output full left column first then full right column.
- Keep visible question numbers and choice labels.
- Do not invent missing words; keep uncertain fragments as-is.
- Keep line breaks that preserve question/choice boundaries."""


TEXT_ONLY_REORDER_USER = """Page index: {page_index}.
Raw extracted text:
{raw_text}

Return cleaned reading-order text only."""


TEXT_ONLY_PAGE_SYSTEM = """You structure one exam page from text only (no image).
Return ONLY valid JSON:
{
  "regions": [],
  "sets": [
    {
      "set_index": 0,
      "context_text": "",
      "continued_from_previous_page": false,
      "continues_on_next_page": false,
      "shared_stems": [{"applies_to_question_numbers":[1,2],"text":"..."}],
      "questions": [
        {
          "question_index": 1,
          "type": "mcq|frq",
          "content": "",
          "options": [{"label":"A","text":"..."}],
          "answer": "",
          "explanation": null,
          "rubric": null,
          "continued_from_previous_page": false,
          "continues_on_next_page": false
        }
      ]
    }
  ]
}
Rules:
- Keep values grounded in the provided text; never invent unseen questions.
- For MCQ, parse option labels like A/B/C/D/E when present.
- Use continuation flags when text clearly starts/ends mid-question.
- regions may be an empty array in text-only mode."""


TEXT_ONLY_PAGE_USER = """Page index: {page_index}
Document hints:
{hint_block}

Previous page tail:
{prev_tail}

Current page text:
{page_text}

Next page head:
{next_head}

Return the JSON object described in the system message."""
