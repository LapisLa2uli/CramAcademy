from typing import Optional


def validate_frq_rubric(rubric: Optional[dict]) -> Optional[str]:
    """Return error message or None if valid."""
    if not rubric:
        return "FRQ must include a grading rubric."

    crit = rubric.get("criteria")
    if isinstance(crit, list):
        if len(crit) == 0:
            return "Add at least one rubric row (name, expectations, points)."
        total = 0.0
        for i, row in enumerate(crit):
            if not isinstance(row, dict):
                return f"Rubric row {i + 1} is invalid."
            if not str(row.get("name", "")).strip():
                return f"Rubric row {i + 1} needs a criterion name."
            if not str(row.get("expectations", "")).strip():
                return f"Rubric row {i + 1} needs expectations."
            try:
                p = float(row.get("points", 0))
            except (TypeError, ValueError):
                return f"Rubric row {i + 1} needs a numeric score."
            if p < 0:
                return f"Rubric row {i + 1}: score cannot be negative."
            total += p
        if total <= 0:
            return "Total rubric points must be greater than zero."
        return None

    if rubric.get("max_score") is not None:
        return None
    return "Rubric must use the criteria table or include max_score."
