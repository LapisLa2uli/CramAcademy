from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Header

from database import get_supabase_admin
from schemas.profile import (
    ProfileMeResponse,
    ProfileUpdateBody,
    ContributionsCalendarResponse,
    ContributionDay,
    profile_response_from_row,
)
from services.authz import get_bearer_user_id, fetch_profile
from services.contributions import (
    aggregate_contribution_calendar,
    level_for_points,
    next_title_info,
    title_for_points,
    FRAME_UNLOCKS,
    THEME_UNLOCKS,
)

router = APIRouter()


def _profile_row_to_me(row: dict) -> ProfileMeResponse:
    pts = int(row.get("contribution_points") or 0)
    nt, np = next_title_info(pts)
    base = profile_response_from_row(row)
    return ProfileMeResponse(
        **base.model_dump(),
        title=title_for_points(pts),
        level=level_for_points(pts),
        next_title=nt,
        points_to_next_title=np,
    )


@router.get("/me", response_model=ProfileMeResponse)
async def get_my_profile(authorization: str = Header(...)):
    uid = get_bearer_user_id(authorization)
    row = fetch_profile(uid)
    return _profile_row_to_me(row)


@router.patch("/me", response_model=ProfileMeResponse)
async def update_my_profile(
    body: ProfileUpdateBody,
    authorization: str = Header(...),
):
    uid = get_bearer_user_id(authorization)
    row = fetch_profile(uid)
    upd: dict = {}
    if body.display_name is not None:
        upd["display_name"] = body.display_name.strip() or None
    if body.bio is not None:
        upd["bio"] = body.bio.strip() or None
    if body.avatar_url is not None:
        url = body.avatar_url.strip()
        if not url:
            upd["avatar_url"] = None
        elif not (url.startswith("http://") or url.startswith("https://")):
            raise HTTPException(400, detail="Avatar URL must be http(s)")
        else:
            upd["avatar_url"] = url

    allowed_themes = {t for t, _ in THEME_UNLOCKS}
    allowed_frames = {f for f, _ in FRAME_UNLOCKS}
    unlocked_t = set(row.get("unlocked_themes") or [])
    unlocked_f = set(row.get("unlocked_frames") or [])
    unlocked_t.add("default")
    unlocked_f.add("none")

    if body.equipped_theme is not None:
        if body.equipped_theme not in unlocked_t:
            raise HTTPException(400, detail="Theme not unlocked")
        if body.equipped_theme not in allowed_themes:
            raise HTTPException(400, detail="Unknown theme")
        upd["equipped_theme"] = body.equipped_theme
    if body.equipped_frame is not None:
        if body.equipped_frame not in unlocked_f:
            raise HTTPException(400, detail="Frame not unlocked")
        if body.equipped_frame not in allowed_frames:
            raise HTTPException(400, detail="Unknown frame")
        upd["equipped_frame"] = body.equipped_frame

    admin = get_supabase_admin()
    if upd:
        admin.table("profiles").update(upd).eq("id", uid).execute()
    row = fetch_profile(uid)
    return _profile_row_to_me(row)


@router.get("/me/contributions", response_model=ContributionsCalendarResponse)
async def my_contributions_calendar(authorization: str = Header(...)):
    uid = get_bearer_user_id(authorization)
    admin = get_supabase_admin()
    since = (datetime.now(timezone.utc) - timedelta(days=400)).isoformat()
    result = (
        admin.table("contribution_grants")
        .select("points, created_at")
        .eq("user_id", uid)
        .gte("created_at", since)
        .execute()
    )
    grants = result.data or []
    days = aggregate_contribution_calendar(grants, days=371)
    total_pts = sum(d["points"] for d in days)
    total_count = sum(d["count"] for d in days)
    return ContributionsCalendarResponse(
        days=[ContributionDay(**d) for d in days],
        total_points=total_pts,
        total_grants=total_count,
    )
