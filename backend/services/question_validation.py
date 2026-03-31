from schemas.question import QuestionCreate
from services.frq_rubric_validation import validate_frq_rubric


def validate_question(question: QuestionCreate) -> list[str]:
    """Return a list of validation errors. Empty list means valid."""
    errors: list[str] = []

    if not question.answer.strip():
        errors.append("Answer cannot be empty.")

    if question.type == "mcq":
        if not question.options or len(question.options) < 2:
            errors.append("MCQ must have at least 2 options.")
        if question.options:
            labels = [o.label for o in question.options]
            if question.answer not in labels:
                errors.append(
                    f"MCQ answer '{question.answer}' must match one of the option labels: {labels}"
                )
    elif question.type == "frq":
        rubric_err = validate_frq_rubric(question.rubric)
        if rubric_err:
            errors.append(rubric_err)

    return errors
