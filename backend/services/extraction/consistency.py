import re
from typing import Iterable

from schemas.extraction import ExtractionSetDraft, ExtractionQuestionDraft


_QREF = re.compile(r"\bQ\s*(\d+)\b", re.IGNORECASE)
_NUM = re.compile(r"\bquestion\s*(\d+)\b", re.IGNORECASE)


def collect_warnings(sets: Iterable[ExtractionSetDraft]) -> list[str]:
    warnings: list[str] = []
    for s in sets:
        for q in s.questions:
            bundle = " ".join(
                filter(
                    None,
                    [
                        q.content,
                        q.explanation or "",
                        q.answer,
                    ],
                )
            )
            for rx in (_QREF, _NUM):
                for m in rx.finditer(bundle):
                    mentioned = int(m.group(1))
                    if mentioned != q.question_index:
                        warnings.append(
                            f"Set {s.set_index} Q{q.question_index}: text references "
                            f"question {mentioned} — verify mapping."
                        )
    return warnings
