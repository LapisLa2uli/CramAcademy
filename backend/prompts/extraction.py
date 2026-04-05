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
- Transcribe all visible text for MCQ stems, choices, answer keys, and explanations.
- For MCQ, include 4 options when present; labels A-D.
- If a passage applies to multiple questions, use one set with context_text + multiple questions.
- If the page has unrelated standalone questions, use separate set_index values (0,1,2...) on this page.
- question_index is 1-based within each set.
- For FRQ, if no rubric is visible, set rubric to null and still extract content and answer (model solution).
"""

PAGE_EXTRACTION_USER = """Page index in document: {page_index} (0-based).
Analyze this page and output the JSON object described in the system message."""
