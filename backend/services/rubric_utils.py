import json
from typing import Any


def resolve_frq_max_score(rubric: dict) -> float:
    """Supports table rubric {criteria: [{name, expectations, points}], max_score} or legacy shapes."""
    crit = rubric.get("criteria")
    if isinstance(crit, list) and len(crit) > 0:
        summed = 0.0
        for row in crit:
            if isinstance(row, dict):
                try:
                    summed += float(row.get("points") or 0)
                except (TypeError, ValueError):
                    pass
        explicit = rubric.get("max_score")
        if explicit is not None:
            try:
                return float(explicit)
            except (TypeError, ValueError):
                pass
        return summed if summed > 0 else 10.0
    try:
        return float(rubric.get("max_score", 10))
    except (TypeError, ValueError):
        return 10.0


def format_rubric_for_prompt(rubric: dict) -> str:
    """Human-readable rubric for the LLM."""
    crit = rubric.get("criteria")
    if isinstance(crit, list) and crit:
        lines: list[str] = []
        for row in crit:
            if not isinstance(row, dict):
                continue
            name = row.get("name") or "Criterion"
            exp = row.get("expectations") or ""
            pts = row.get("points", 0)
            lines.append(f"• {name} — up to {pts} point(s)\n  Expectations: {exp}")
        if lines:
            return "\n".join(lines)
    return json.dumps(rubric, indent=2)
