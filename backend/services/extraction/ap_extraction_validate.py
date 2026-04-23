"""
Structural validation for merged AP-style extraction results.

Produces human-readable warnings and optional page indices for a higher-DPI
re-extraction pass (e.g. Calculus MCQ with empty options after vision).
"""

from __future__ import annotations

import re
from schemas.extraction import ExtractionQuestionDraft, ExtractionSetDraft, PdfDocumentProfile


def _dollar_balance(s: str) -> int:
    """Rough count: $ opens/closes; ignore $$ pairs."""
    if not s:
        return 0
    stripped = re.sub(r"\$\$[\s\S]*?\$\$", "", s)
    singles = re.findall(r"(?<!\$)\$(?!\$)", stripped)
    return len(singles)


def _mcq_choice_labels(q: ExtractionQuestionDraft) -> set[str]:
    if not q.options:
        return set()
    out: set[str] = set()
    for o in q.options:
        if isinstance(o, dict) and o.get("label") is not None:
            out.add(str(o["label"]).strip().upper()[:1])
    return out


def validate_extraction_structure(
    sets: list[ExtractionSetDraft],
    profile: PdfDocumentProfile,
) -> tuple[list[str], list[int]]:
    """
    Returns (warnings, page_indices_suggested_for_retry).

    Page retry suggestions are best-effort from set.source_page_indices when
    integrity checks fail inside that set.
    """
    warnings: list[str] = []
    retry_pages: set[int] = set()

    all_q: list[tuple[int, ExtractionQuestionDraft]] = []
    for s in sets:
        for q in s.questions:
            all_q.append((s.set_index, q))

    seen_idx: dict[tuple[int, int], int] = {}
    for sid, q in all_q:
        key = (sid, q.question_index)
        if key in seen_idx:
            warnings.append(
                f"Duplicate question_index {q.question_index} in set {sid} "
                f"(also appears multiple times) — verify merge."
            )
        seen_idx[key] = 1

    exp_choices = profile.expected_mcq_choice_count
    exp_mcq = profile.expected_mcq_question_count

    mcq_total = sum(1 for _, q in all_q if q.type == "mcq")
    if exp_mcq is not None and mcq_total and abs(mcq_total - exp_mcq) > 3:
        warnings.append(
            f"Expected about {exp_mcq} MCQs for profile {profile.family}; "
            f"found {mcq_total}. Missing pages/columns or skipped sections may explain the gap."
        )

    for s in sets:
        src_pages = list(s.source_page_indices or [])
        for q in s.questions:
            if q.type != "mcq":
                if q.options:
                    warnings.append(
                        f"Set {s.set_index} Q{q.question_index}: FRQ has options — verify type."
                    )
                bal = _dollar_balance(q.content)
                if bal % 2 == 1 and profile.family == "college_board_calc":
                    warnings.append(
                        f"Set {s.set_index} Q{q.question_index}: unbalanced `$` in stem — "
                        "check LaTeX or re-scan page."
                    )
                    for p in src_pages:
                        retry_pages.add(p)
                continue

            labels = _mcq_choice_labels(q)
            n_opts = len(q.options or [])
            if n_opts == 0:
                warnings.append(
                    f"Set {s.set_index} Q{q.question_index}: MCQ has no options — "
                    "likely figure-heavy or vision miss."
                )
                for p in src_pages:
                    retry_pages.add(p)
            elif exp_choices is not None and n_opts < exp_choices - 1:
                warnings.append(
                    f"Set {s.set_index} Q{q.question_index}: only {n_opts} options "
                    f"(expected ~{exp_choices})."
                )
                for p in src_pages:
                    retry_pages.add(p)

            if exp_choices == 5 and not labels.intersection({"E"}) and n_opts == 4:
                warnings.append(
                    f"Set {s.set_index} Q{q.question_index}: five-choice exam but only four "
                    "options captured."
                )

            for o in q.options or []:
                if not isinstance(o, dict):
                    continue
                txt = str(o.get("text") or "").strip()
                if not txt and not o.get("image_url"):
                    warnings.append(
                        f"Set {s.set_index} Q{q.question_index} option {o.get('label')}: empty text — "
                        "visual option or extraction gap."
                    )
                    for p in src_pages:
                        retry_pages.add(p)

            bal = _dollar_balance(q.content)
            if bal % 2 == 1 and profile.family == "college_board_calc":
                warnings.append(
                    f"Set {s.set_index} Q{q.question_index}: unbalanced `$` in MCQ stem."
                )
                for p in src_pages:
                    retry_pages.add(p)

    return warnings, sorted(retry_pages)
