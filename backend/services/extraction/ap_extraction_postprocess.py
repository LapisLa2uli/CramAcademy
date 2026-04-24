"""
Canonical post-processing for merged extraction sets (AP-style exams).

Runs after merge_page_results: World shared-stem hints from PDF text,
soft hyphen cleanup for Marco Lang prose, optional shared_stem backfill.
"""

from __future__ import annotations

import re
from schemas.extraction import ExtractionSetDraft, PdfDocumentProfile, SharedStemDraft


# "Questions 1–3 refer to the passage below." (en dash or hyphen)
_RE_WORLD_BLOCK = re.compile(
    r"Questions\s+(\d+)\s*[–-]\s*(\d+)\s+refer\s+to\s+(?:the\s+)?(?:passage|following|recipe|two\s+poems|image)\s+[^.\n]*\.\s*",
    re.I | re.MULTILINE,
)


def join_soft_hyphen_linebreaks(text: str) -> str:
    """Join common exam hyphenation breaks: 'calami-\ntous' -> 'calamitous'."""
    if not text:
        return text
    s = re.sub(r"([A-Za-z])-\s*\n\s*([a-z])", r"\1\2", text)
    s = re.sub(r"([a-z])\s*\n\s*([a-z])", r"\1 \2", s)
    return s


def _extract_world_stem_blocks(full_text: str) -> list[tuple[int, int, str]]:
    out: list[tuple[int, int, str]] = []
    for m in _RE_WORLD_BLOCK.finditer(full_text):
        lo, hi = int(m.group(1)), int(m.group(2))
        start = m.end()
        nxt = _RE_WORLD_BLOCK.search(full_text, start)
        end = nxt.start() if nxt else len(full_text)
        stem_body = full_text[start:end].strip()
        # Trim trailing administrative lines
        stem_body = re.split(r"\n\s*\d+\.\s", stem_body, maxsplit=1)[0].strip()
        if stem_body and lo <= hi:
            out.append((lo, hi, stem_body))
    return out


def apply_world_shared_stems_from_text(
    sets: list[ExtractionSetDraft],
    pdf_text_by_page: dict[int, str],
    *,
    max_page: int,
) -> list[ExtractionSetDraft]:
    """Backfill shared_stems from explicit 'Questions X–Y refer…' blocks in the PDF text."""
    ordered = "\n\n".join(
        (pdf_text_by_page.get(i) or "").strip() for i in range(max_page) if (pdf_text_by_page.get(i) or "").strip()
    )
    blocks = _extract_world_stem_blocks(ordered)
    if not blocks:
        return sets

    for s in sets:
        nums_in_set = {q.question_index for q in s.questions}
        existing = {(tuple(x.applies_to_question_numbers), x.text) for x in s.shared_stems}
        for lo, hi, stem in blocks:
            affected = [n for n in range(lo, hi + 1) if n in nums_in_set]
            if not affected:
                continue
            key = (tuple(range(lo, hi + 1)), stem)
            if key in existing:
                continue
            s.shared_stems.append(
                SharedStemDraft(applies_to_question_numbers=list(range(lo, hi + 1)), text=stem)
            )
            existing.add(key)
    return sets


def apply_marco_hyphen_cleanup(sets: list[ExtractionSetDraft]) -> list[ExtractionSetDraft]:
    """Normalize soft line breaks in stems/options for Marco-style prose exams."""
    for s in sets:
        if s.context_text:
            s.context_text = join_soft_hyphen_linebreaks(s.context_text)
        for st in s.shared_stems:
            st.text = join_soft_hyphen_linebreaks(st.text)
        for q in s.questions:
            q.content = join_soft_hyphen_linebreaks(q.content)
            if q.options:
                for o in q.options:
                    if isinstance(o, dict) and o.get("text"):
                        o["text"] = join_soft_hyphen_linebreaks(str(o["text"]))
            if q.explanation:
                q.explanation = join_soft_hyphen_linebreaks(q.explanation)
    return sets


def apply_canonical_postprocess(
    sets: list[ExtractionSetDraft],
    profile: PdfDocumentProfile,
    pdf_text_by_page: dict[int, str],
    *,
    max_page: int,
) -> list[ExtractionSetDraft]:
    family = profile.family
    if family == "college_board_world":
        sets = apply_world_shared_stems_from_text(sets, pdf_text_by_page, max_page=max_page)
    if family in ("marco_ap_lang", "college_board_ap_lang"):
        sets = apply_marco_hyphen_cleanup(sets)
    return sets
