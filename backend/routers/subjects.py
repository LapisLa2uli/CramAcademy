from fastapi import APIRouter, HTTPException, Header
from typing import Optional

from schemas.subject import SubjectCreate, SubjectUpdate, SubjectResponse
from database import get_supabase_admin
from services.authz import get_bearer_user_id, fetch_profile, require_min_role

router = APIRouter()


@router.get("", response_model=list[SubjectResponse])
async def list_subjects(authorization: Optional[str] = Header(None)):
    """Public list of all subjects, ordered by position."""
    client = get_supabase_admin()
    result = client.table("subjects").select("*").order("position").execute()
    return result.data or []


@router.post("", response_model=SubjectResponse)
async def create_subject(req: SubjectCreate, authorization: str = Header(...)):
    actor = fetch_profile(get_bearer_user_id(authorization))
    require_min_role(actor, "admin")
    client = get_supabase_admin()

    result = client.table("subjects").insert({
        "name": req.name.strip(),
        "levels": req.levels,
        "position": req.position,
    }).execute()

    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to create subject")
    return result.data[0]


@router.patch("/{subject_id}", response_model=SubjectResponse)
async def update_subject(
    subject_id: str,
    body: SubjectUpdate,
    authorization: str = Header(...),
):
    actor = fetch_profile(get_bearer_user_id(authorization))
    require_min_role(actor, "admin")
    client = get_supabase_admin()

    existing = client.table("subjects").select("*").eq("id", subject_id).execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Subject not found")

    patch = body.model_dump(exclude_unset=True)
    if "name" in patch:
        patch["name"] = patch["name"].strip()
    if not patch:
        return existing.data[0]

    client.table("subjects").update(patch).eq("id", subject_id).execute()
    updated = client.table("subjects").select("*").eq("id", subject_id).execute()
    return updated.data[0]


@router.delete("/{subject_id}")
async def delete_subject(subject_id: str, authorization: str = Header(...)):
    actor = fetch_profile(get_bearer_user_id(authorization))
    require_min_role(actor, "admin")
    client = get_supabase_admin()

    existing = client.table("subjects").select("id").eq("id", subject_id).execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Subject not found")

    # Unlink questions that referenced this subject
    client.table("questions").update({"subject_id": None}).eq("subject_id", subject_id).execute()
    client.table("subjects").delete().eq("id", subject_id).execute()
    return {"status": "deleted", "id": subject_id}
