import random
from typing import Literal

from database import get_supabase_admin


def _apply_filters(query, subject: str, difficulty: str | None, course_level: str | None, grade_level: int | None):
    query = query.eq("subject", subject)
    if difficulty:
        query = query.eq("difficulty", difficulty)
    if course_level:
        query = query.eq("course_level", course_level)
    if grade_level is not None:
        query = query.eq("grade_level", grade_level)
    return query


async def generate_test_questions(
    *,
    user_id: str,
    subject: str,
    difficulty: str | None,
    num_questions: int,
    course_level: str | None = None,
    grade_level: int | None = None,
    question_source: Literal["personal", "community", "both"] = "both",
) -> list[dict]:
    """Select random questions from personal bank, community bank, or both."""
    client = get_supabase_admin()

    pools: list[dict] = []

    if question_source in ("community", "both"):
        q = client.table("questions").select("*")
        q = _apply_filters(q, subject, difficulty, course_level, grade_level)
        q = q.eq("validated", True).eq("pool", "community")
        res = q.execute()
        pools.extend(res.data or [])

    if question_source in ("personal", "both"):
        q = client.table("questions").select("*")
        q = _apply_filters(q, subject, difficulty, course_level, grade_level)
        q = q.eq("creator_id", user_id).eq("pool", "personal")
        res = q.execute()
        pools.extend(res.data or [])

    # Deduplicate by id when both
    seen: set[str] = set()
    unique: list[dict] = []
    for row in pools:
        qid = row.get("id")
        if qid and qid not in seen:
            seen.add(qid)
            unique.append(row)

    if len(unique) <= num_questions:
        return unique

    return random.sample(unique, num_questions)
