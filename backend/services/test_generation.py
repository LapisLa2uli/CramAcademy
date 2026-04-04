import random
from typing import Literal

from database import get_supabase_admin


def _apply_filters(query, subject: str, difficulty: str | None, course_level: str | None, grade_level: int | None, question_type: str | None = None):
    query = query.eq("subject", subject)
    if difficulty:
        query = query.eq("difficulty", difficulty)
    if course_level:
        query = query.eq("course_level", course_level)
    if grade_level is not None:
        query = query.eq("grade_level", grade_level)
    if question_type:
        query = query.eq("type", question_type)
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
    question_type: str | None = None,
) -> list[dict]:
    """Select random questions from personal bank, community bank, or both.

    When a selected question belongs to a question set, ALL sibling questions
    in that set are pulled in (to keep the context group together).
    The total number of returned questions will equal ``num_questions``.
    """
    client = get_supabase_admin()

    pools: list[dict] = []

    if question_source in ("community", "both"):
        q = client.table("questions").select("*")
        q = _apply_filters(q, subject, difficulty, course_level, grade_level, question_type)
        q = q.eq("validated", True).eq("pool", "community")
        res = q.execute()
        pools.extend(res.data or [])

    if question_source in ("personal", "both"):
        q = client.table("questions").select("*")
        q = _apply_filters(q, subject, difficulty, course_level, grade_level, question_type)
        q = q.eq("creator_id", user_id).eq("pool", "personal")
        res = q.execute()
        pools.extend(res.data or [])

    # Deduplicate by id
    seen: set[str] = set()
    unique: list[dict] = []
    for row in pools:
        qid = row.get("id")
        if qid and qid not in seen:
            seen.add(qid)
            unique.append(row)

    # Separate into set-grouped questions and standalone questions
    set_groups: dict[str, list[dict]] = {}  # set_id -> list of questions
    standalone: list[dict] = []

    for q in unique:
        set_id = q.get("question_set_id")
        if set_id:
            set_groups.setdefault(set_id, []).append(q)
        else:
            standalone.append(q)

    # Sort each set group by position_in_set
    for set_id in set_groups:
        set_groups[set_id].sort(key=lambda q: q.get("position_in_set") or 0)

    # For sets whose questions were partially fetched (some siblings didn't
    # match the filters), load the full sibling list so the set stays complete.
    for set_id, group in list(set_groups.items()):
        group_ids = {q["id"] for q in group}
        full = (
            client.table("questions")
            .select("*")
            .eq("question_set_id", set_id)
            .order("position_in_set")
            .execute()
        )
        full_list = full.data or []
        if len(full_list) != len(group):
            # Replace with full sibling list
            set_groups[set_id] = full_list

    # Build the final selection: pick complete sets first, then fill with standalone
    selected: list[dict] = []
    remaining = num_questions

    # Shuffle set groups and standalone for randomness
    set_ids = list(set_groups.keys())
    random.shuffle(set_ids)
    random.shuffle(standalone)

    for set_id in set_ids:
        group = set_groups[set_id]
        if len(group) <= remaining:
            selected.extend(group)
            remaining -= len(group)
        # Skip sets that are too large to fit

    # Fill remaining slots with standalone questions
    if remaining > 0:
        selected.extend(standalone[:remaining])

    return selected
