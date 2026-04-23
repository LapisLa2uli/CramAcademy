"""
Fingerprint AP-style practice PDFs and classify pages for vision extraction.

Uses the same text layer as pdf_text_hint (pypdf); headers survive even when
math glyphs are corrupted (e.g. legacy Calculus PDFs).
"""

from __future__ import annotations

import re

from schemas.extraction import PdfDocumentProfile, PdfExamFamily, PdfPageRole, PdfPageSegment

_RE_USE_SHEET = re.compile(r"use this sheet to record", re.I)
_RE_STUDENT_ANSWER_SHEET = re.compile(r"student answer sheet", re.I)
_RE_RECORD_ANSWERS = re.compile(r"record your answers", re.I)
_RE_SECTION1_GRID = re.compile(r"section\s*1:.*multiple-?choice", re.I)
_RE_DIRECTIONS_ADMIN = re.compile(r"directions for administration", re.I)
_RE_MC_ANSWER_KEY = re.compile(r"multiple-?choice\s+answer\s+key", re.I)
_RE_ANSWER_KEY_SHORT = re.compile(r"^\s*answer\s+key\s*$", re.I | re.M)
_RE_SCORING = re.compile(
    r"free-?response\s+scoring\s+guidelines|scoring\s+guidelines|scoring\s+rubric",
    re.I,
)
_RE_TOC_STRONG = re.compile(r"^\s*contents\s*$", re.I | re.M)


def _join_early_text(pdf_text_by_page: dict[int, str], max_pages: int = 6, cap: int = 16000) -> str:
    chunks: list[str] = []
    for i in range(max_pages):
        t = (pdf_text_by_page.get(i) or "").strip()
        if t:
            chunks.append(t)
    blob = "\n".join(chunks)
    return blob[:cap]


def _detect_family(blob: str) -> tuple[PdfExamFamily, str, list[str]]:
    low = blob.lower()
    signals: list[str] = []

    if "marco learning" in low or "www.marcolearning.com" in low:
        signals.append("marco_branding")
    if "english language" in low and "composition" in low:
        signals.append("ap_english_language")
    if signals and ("ap_english_language" in signals or "marco_branding" in signals):
        if "english language" in low:
            return "marco_ap_lang", "Marco Learning", signals

    if "college board" in low or "ap central" in low:
        signals.append("college_board")
    if "world history" in low and "practice exam" in low:
        signals.append("ap_world_history")
        if "college board" in low or "©" in blob:
            return "college_board_world", "College Board", signals
    if "world history" in low:
        signals.append("ap_world_history_loose")
        return "college_board_world", "College Board", signals

    if "calculus" in low and ("practice exam" in low or "ap® calculus" in low or "ap calculus" in low):
        signals.append("ap_calculus")
        return "college_board_calc", "College Board", signals

    if "college board" in low:
        return "college_board_generic", "College Board", signals

    return "unknown", "", signals


def _defaults_for_family(family: PdfExamFamily) -> tuple[int | None, int | None]:
    if family == "marco_ap_lang":
        return 5, 45
    if family == "college_board_world":
        return 4, 55
    if family == "college_board_calc":
        return 5, 45
    return None, None


def classify_page_text(text: str, page_index: int) -> PdfPageRole:
    """Assign a coarse role using header phrases (first ~15k chars)."""
    t = (text or "")[:15000]
    low = t.lower()

    if _RE_SCORING.search(t):
        return "scoring"
    if _RE_MC_ANSWER_KEY.search(t) or _RE_ANSWER_KEY_SHORT.search(t):
        return "answer_key"
    if _RE_DIRECTIONS_ADMIN.search(t):
        return "directions"
    if _RE_USE_SHEET.search(t) or _RE_STUDENT_ANSWER_SHEET.search(t):
        return "answer_sheet"
    if _RE_RECORD_ANSWERS.search(t) and _RE_SECTION1_GRID.search(t):
        return "answer_sheet"

    if _RE_TOC_STRONG.search(t) and "section i" in low:
        if "questions " not in low and not re.search(r"\n\s*\d+\.\s+", t):
            return "toc"

    if page_index <= 2 and len(t) < 900 and "equity and access" in low:
        return "boilerplate"

    return "exam_content"


def build_document_profile(
    pdf_text_by_page: dict[int, str],
    *,
    max_pages_index: int,
) -> PdfDocumentProfile:
    """
    Build profile from 0..max_pages_index-1 text snippets (keys are 0-based page indices).
    """
    early = _join_early_text(pdf_text_by_page, max_pages=min(8, max_pages_index))
    family, publisher, signals = _detect_family(early)
    exp_choices, exp_mcq = _defaults_for_family(family)

    pages: list[PdfPageSegment] = []
    for pi in range(max_pages_index):
        text = pdf_text_by_page.get(pi) or ""
        role = classify_page_text(text, pi)
        skip = role in (
            "answer_sheet",
            "directions",
            "answer_key",
            "scoring",
            "toc",
            "boilerplate",
        )
        pages.append(PdfPageSegment(page_index=pi, role=role, extract_vision=not skip))

    return PdfDocumentProfile(
        family=family,
        publisher=publisher,
        signals=signals,
        expected_mcq_choice_count=exp_choices,
        expected_mcq_question_count=exp_mcq,
        pages=pages,
    )
