from fastapi import APIRouter, HTTPException, Header

from database import get_supabase_admin
from services.authz import get_bearer_user_id, fetch_profile, require_min_role
from schemas.profile import AdminUserRow, AdminUpdateUserBody
from services.username import (
    assert_username_available,
    normalize_username,
    validate_username_format,
)

router = APIRouter()


def _ensure_profile_exists(client, user_id: str) -> dict:
    r = client.table("profiles").select("*").eq("id", user_id).execute()
    if not r.data:
        raise HTTPException(status_code=404, detail="User not found")
    return r.data[0]


@router.get("/users", response_model=list[AdminUserRow])
async def admin_list_users(authorization: str = Header(...)):
    actor = fetch_profile(get_bearer_user_id(authorization))
    require_min_role(actor, "admin")

    client = get_supabase_admin()
    users: list = []
    page = 1
    per_page = 200
    while True:
        batch = client.auth.admin.list_users(page=page, per_page=per_page)
        if not batch:
            break
        users.extend(batch)
        if len(batch) < per_page:
            break
        page += 1

    profiles = client.table("profiles").select("*").execute()
    by_id = {str(p["id"]): p for p in (profiles.data or [])}

    rows: list[dict] = []
    for u in users:
        uid = str(u.id)
        p = by_id.get(uid, {})
        created = p.get("created_at")
        if created is None and u.created_at is not None:
            created = u.created_at.isoformat()
        rows.append(
            {
                "id": uid,
                "email": u.email or p.get("email"),
                "username": p.get("username"),
                "role": p.get("role", "user"),
                "created_at": created,
            }
        )
    return rows


@router.patch("/users/{user_id}", response_model=AdminUserRow)
async def admin_update_user(
    user_id: str,
    body: AdminUpdateUserBody,
    authorization: str = Header(...),
):
    actor = fetch_profile(get_bearer_user_id(authorization))
    require_min_role(actor, "admin")

    if str(user_id) == str(actor["id"]) and body.role is not None and body.role != actor.get(
        "role"
    ):
        raise HTTPException(
            status_code=400,
            detail="Use another admin to change your own role.",
        )

    client = get_supabase_admin()
    _ensure_profile_exists(client, user_id)

    upd: dict = {}
    if body.username is not None:
        u = normalize_username(body.username)
        if not u:
            raise HTTPException(status_code=400, detail="Username cannot be empty")
        validate_username_format(u)
        merged_row = client.table("profiles").select("username").eq("id", user_id).execute().data[0]
        if u != normalize_username(merged_row.get("username") or ""):
            assert_username_available(u, user_id)
            upd["username"] = u
    if body.role is not None:
        if body.role not in ("user", "moderator", "admin"):
            raise HTTPException(status_code=400, detail="Invalid role")
        upd["role"] = body.role

    if upd:
        client.table("profiles").update(upd).eq("id", user_id).execute()

    merged = client.table("profiles").select("*").eq("id", user_id).execute().data[0]
    email = merged.get("email")
    try:
        auth_u = client.auth.admin.get_user_by_id(user_id)
        if auth_u and auth_u.user and auth_u.user.email:
            email = auth_u.user.email
    except Exception:
        pass
    return {
        "id": merged["id"],
        "email": email,
        "username": merged.get("username"),
        "role": merged.get("role", "user"),
        "created_at": merged.get("created_at"),
    }


@router.delete("/users/{user_id}")
async def admin_delete_user(user_id: str, authorization: str = Header(...)):
    actor = fetch_profile(get_bearer_user_id(authorization))
    require_min_role(actor, "admin")
    if str(user_id) == str(actor["id"]):
        raise HTTPException(status_code=400, detail="Cannot delete your own account")

    client = get_supabase_admin()
    _ensure_profile_exists(client, user_id)
    client.auth.admin.delete_user(user_id)
    return {"status": "deleted", "id": user_id}
