"""Contribution points, titles, levels, and cosmetic unlocks."""

from datetime import datetime, timedelta, timezone
from typing import Any

# Points granted when a question is first approved into the community pool
POINTS_MCQ = 1
POINTS_FRQ = 5

# (min_points, title_display_name) — highest matching tier wins
TITLE_TIERS: list[tuple[int, str]] = [
    (0, "Novice"),
    (15, "Junior Crammer"),
    (60, "Senior Crammer"),
    (200, "Expert Crammer"),
    (500, "Master of All Crammers"),
]

# Level = 1 + floor(points / LEVEL_POINTS_STEP)
LEVEL_POINTS_STEP = 25

# (cosmetic_id, min_points) — unlocked when total points >= threshold
THEME_UNLOCKS: list[tuple[str, int]] = [
    ("default", 0),
    ("ocean", 30),
    ("midnight", 80),
    ("aurora", 200),
]

FRAME_UNLOCKS: list[tuple[str, int]] = [
    ("none", 0),
    ("bronze", 20),
    ("silver", 75),
    ("gold", 250),
]


def title_for_points(points: int) -> str:
    chosen = TITLE_TIERS[0][1]
    for threshold, name in TITLE_TIERS:
        if points >= threshold:
            chosen = name
    return chosen


def level_for_points(points: int) -> int:
    return 1 + max(0, points) // LEVEL_POINTS_STEP


def next_title_info(points: int) -> tuple[str | None, int | None]:
    """Next title to unlock (name, points still needed), or (None, None) at max tier."""
    for threshold, name in TITLE_TIERS:
        if threshold > 0 and points < threshold:
            return name, threshold - points
    return None, None


def unlocked_themes_for_points(points: int) -> list[str]:
    return [tid for tid, th in THEME_UNLOCKS if points >= th]


def unlocked_frames_for_points(points: int) -> list[str]:
    return [fid for fid, th in FRAME_UNLOCKS if points >= th]


def sync_profile_unlocks(admin: Any, user_id: str, points: int) -> None:
    """Recompute unlocked cosmetics from total points; fix invalid equipped."""
    ut = unlocked_themes_for_points(points)
    uf = unlocked_frames_for_points(points)
    row = admin.table("profiles").select("equipped_theme, equipped_frame").eq("id", user_id).execute()
    eq = row.data[0] if row.data else {}
    theme = eq.get("equipped_theme") or "default"
    frame = eq.get("equipped_frame") or "none"
    if theme not in ut:
        theme = "default"
    if frame not in uf:
        frame = "none"
    admin.table("profiles").update(
        {
            "unlocked_themes": ut,
            "unlocked_frames": uf,
            "equipped_theme": theme,
            "equipped_frame": frame,
        }
    ).eq("id", user_id).execute()


def grant_points_for_approved_question(admin: Any, question: dict) -> None:
    """Idempotent: one grant per question_id."""
    creator_id = question.get("creator_id")
    if not creator_id:
        return
    qid = question["id"]
    existing = (
        admin.table("contribution_grants").select("id").eq("question_id", qid).execute()
    )
    if existing.data:
        return
    qtype = (question.get("type") or "mcq").lower()
    pts = POINTS_MCQ if qtype == "mcq" else POINTS_FRQ
    admin.table("contribution_grants").insert(
        {"user_id": creator_id, "question_id": qid, "points": pts}
    ).execute()
    prof = (
        admin.table("profiles")
        .select("contribution_points")
        .eq("id", creator_id)
        .execute()
    )
    cur = 0
    if prof.data:
        cur = int(prof.data[0].get("contribution_points") or 0)
    new_total = cur + pts
    admin.table("profiles").update({"contribution_points": new_total}).eq(
        "id", creator_id
    ).execute()
    sync_profile_unlocks(admin, creator_id, new_total)


def aggregate_contribution_calendar(
    grants: list[dict], days: int = 371
) -> list[dict]:
    """List of { date: 'YYYY-MM-DD', points, count } for each day in range (ending today UTC)."""
    end = datetime.now(timezone.utc).date()
    start = end - timedelta(days=days - 1)
    by_day: dict[str, dict] = {}
    d = start
    while d <= end:
        key = d.isoformat()
        by_day[key] = {"date": key, "points": 0, "count": 0}
        d += timedelta(days=1)
    for g in grants:
        raw = g.get("created_at")
        if not raw:
            continue
        key = str(raw)[:10]
        if key not in by_day:
            continue
        by_day[key]["points"] += int(g.get("points") or 0)
        by_day[key]["count"] += 1
    return [by_day[k] for k in sorted(by_day.keys())]


def list_rejection_reasons() -> list[dict[str, str]]:
    return [
        {"id": "question_already_exists", "label": "Question already exists"},
        {"id": "unclear_question_or_choices", "label": "Unclear question or choices"},
        {"id": "wrong_answer", "label": "Wrong answer"},
        {"id": "incomplete_rubric", "label": "Incomplete rubric"},
        {"id": "policy_violation", "label": "Policy violation"},
        {"id": "low_quality_or_spam", "label": "Low quality or spam"},
        {"id": "other", "label": "Other"},
    ]
