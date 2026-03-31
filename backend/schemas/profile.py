from pydantic import BaseModel, Field


class ProfileResponse(BaseModel):
    id: str
    email: str
    username: str
    display_name: str | None = None
    bio: str | None = None
    avatar_url: str | None = None
    role: str
    contribution_points: int = 0
    equipped_theme: str = "default"
    equipped_frame: str = "none"
    unlocked_themes: list[str] = Field(default_factory=list)
    unlocked_frames: list[str] = Field(default_factory=list)
    created_at: str


def profile_response_from_row(p: dict) -> ProfileResponse:
    uid = str(p["id"])
    uname = (p.get("username") or "").strip()
    if not uname:
        uname = f"crammer_{uid.replace('-', '')[:12]}"
    return ProfileResponse(
        id=uid,
        email=p.get("email") or "",
        username=uname,
        display_name=p.get("display_name"),
        bio=p.get("bio"),
        avatar_url=p.get("avatar_url"),
        role=p.get("role", "user"),
        contribution_points=int(p.get("contribution_points") or 0),
        equipped_theme=p.get("equipped_theme") or "default",
        equipped_frame=p.get("equipped_frame") or "none",
        unlocked_themes=list(p.get("unlocked_themes") or []),
        unlocked_frames=list(p.get("unlocked_frames") or []),
        created_at=str(p.get("created_at", "")),
    )


class ProfileMeResponse(ProfileResponse):
    """Profile with computed gamification fields."""

    title: str
    level: int
    next_title: str | None = None
    points_to_next_title: int | None = None


class ProfileUpdateBody(BaseModel):
    display_name: str | None = Field(None, max_length=120)
    bio: str | None = Field(None, max_length=2000)
    avatar_url: str | None = Field(None, max_length=2000)
    equipped_theme: str | None = None
    equipped_frame: str | None = None


class ContributionDay(BaseModel):
    date: str
    points: int
    count: int


class ContributionsCalendarResponse(BaseModel):
    days: list[ContributionDay]
    total_points: int
    total_grants: int


class AdminUserRow(BaseModel):
    id: str
    email: str | None = None
    username: str | None = None
    display_name: str | None = None
    role: str
    created_at: str | None = None


class AdminUpdateUserBody(BaseModel):
    display_name: str | None = None
    role: str | None = None
