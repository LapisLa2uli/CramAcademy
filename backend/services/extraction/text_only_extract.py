from __future__ import annotations

import re
from typing import Any


def extract_questions_heuristic(page_text: str) -> list[dict[str, Any]]:
    lines = [ln.strip() for ln in page_text.splitlines() if ln.strip()]
    if not lines:
        return []
    q_pat = re.compile(r"^(\d{1,3})[\.\)]\s+(.*)$")
    opt_pat = re.compile(r"^\(?([A-E])[\)\.]\s+(.*)$")
    questions: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    for ln in lines:
        qm = q_pat.match(ln)
        if qm:
            if current is not None:
                questions.append(current)
            current = {
                "question_index": int(qm.group(1)),
                "type": "mcq",
                "content": qm.group(2).strip(),
                "options": [],
                "answer": "",
                "explanation": None,
                "rubric": None,
                "continued_from_previous_page": False,
                "continues_on_next_page": False,
            }
            continue
        om = opt_pat.match(ln)
        if om and current is not None:
            current["options"].append(
                {"label": om.group(1), "text": om.group(2).strip()}
            )
            continue
        if current is not None:
            if current.get("options"):
                last = current["options"][-1]
                last["text"] = (last.get("text") or "") + " " + ln
            else:
                current["content"] = (current.get("content") or "") + " " + ln
    if current is not None:
        questions.append(current)

    for q in questions:
        opts = q.get("options")
        if not isinstance(opts, list) or len(opts) < 2:
            q["type"] = "frq"
            q["options"] = None
    return questions


def build_text_only_fallback_payload(page_text: str) -> tuple[dict[str, Any], list[str]]:
    warnings: list[str] = []
    questions = extract_questions_heuristic(page_text)
    payload: dict[str, Any] = {
        "regions": [],
        "sets": [
            {
                "set_index": 0,
                "context_text": "",
                "continued_from_previous_page": False,
                "continues_on_next_page": False,
                "shared_stems": [],
                "questions": questions,
            }
        ],
    }
    if not questions:
        payload["sets"] = []
        warnings.append("Text-only heuristics found no questions.")
    return payload, warnings
