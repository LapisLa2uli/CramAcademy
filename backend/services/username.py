import re

from fastapi import HTTPException

from database import get_supabase_admin

# Stored usernames are lowercase; 3–30 chars, GitHub-ish safe set.
_USERNAME_RE = re.compile(r"^[a-z0-9_]{3,30}$")


def normalize_username(raw: str) -> str:
    return raw.strip().lower()


def validate_username_format(normalized: str) -> None:
    if not _USERNAME_RE.fullmatch(normalized):
        raise HTTPException(
            status_code=400,
            detail=(
                "Username must be 3–30 characters: lowercase letters, digits, "
                "and underscores only."
            ),
        )


def assert_username_available(username: str, exclude_user_id: str) -> None:
    admin = get_supabase_admin()
    r = admin.table("profiles").select("id").eq("username", username).execute()
    for row in r.data or []:
        if str(row["id"]) != str(exclude_user_id):
            raise HTTPException(status_code=409, detail="Username already taken")
