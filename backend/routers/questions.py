from fastapi import APIRouter, HTTPException, Header
from typing import Optional
from postgrest.exceptions import APIError

from schemas.question import (
    QuestionCreate,
    QuestionRejectBody,
    QuestionResponse,
    QuestionUpdate,
)
from services.question_validation import validate_question
from services.authz import (
    get_bearer_user_id,
    fetch_profile,
    require_min_role,
    role_rank,
)
from database import get_supabase_admin
from services.contributions import (
    grant_points_for_approved_question,
    list_rejection_reasons,
)

router = APIRouter()

_ALLOWED_REJECT_IDS = {r["id"] for r in list_rejection_reasons()}
_REJECT_LABELS = {r["id"]: r["label"] for r in list_rejection_reasons()}


def _fetch_question_row(client, question_id: str) -> dict:
    result = client.table("questions").select("*").eq("id", question_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Question not found")
    return result.data[0]


def _can_edit_question(profile: dict, row: dict) -> bool:
    uid = str(profile["id"])
    if str(row.get("creator_id") or "") == uid and row.get("pool") == "personal":
        return True
    return role_rank(profile.get("role")) >= role_rank("moderator")


def _can_delete_question(profile: dict, row: dict) -> bool:
    uid = str(profile["id"])
    if str(row.get("creator_id") or "") == uid and row.get("pool") == "personal":
        return True
    return role_rank(profile.get("role")) >= role_rank("moderator")


def _can_view_question(profile: dict, row: dict) -> bool:
    uid = str(profile["id"])
    if str(row.get("creator_id") or "") == uid:
        return True
    if role_rank(profile.get("role")) >= role_rank("moderator"):
        return True
    if row.get("validated") and row.get("pool") == "community":
        return True
    return False


@router.get("/my-bank", response_model=list[QuestionResponse])
async def list_my_bank(
    authorization: str = Header(...),
):
    user_id = get_bearer_user_id(authorization)
    client = get_supabase_admin()
    result = (
        client.table("questions")
        .select("*")
        .eq("creator_id", user_id)
        .order("created_at", desc=True)
        .execute()
    )
    return result.data or []


@router.get("/moderation-queue", response_model=list[QuestionResponse])
async def moderation_queue(authorization: str = Header(...)):
    profile = fetch_profile(get_bearer_user_id(authorization))
    require_min_role(profile, "moderator")
    client = get_supabase_admin()
    result = (
        client.table("questions")
        .select("*")
        .eq("pool", "community_pending")
        .order("created_at", desc=True)
        .execute()
    )
    return result.data or []


@router.get("/community-bank", response_model=list[QuestionResponse])
async def community_bank(authorization: str = Header(...)):
    profile = fetch_profile(get_bearer_user_id(authorization))
    require_min_role(profile, "moderator")
    client = get_supabase_admin()
    result = (
        client.table("questions")
        .select("*")
        .eq("pool", "community")
        .eq("validated", True)
        .order("created_at", desc=True)
        .limit(300)
        .execute()
    )
    return result.data or []


@router.get("/rejection-reasons")
async def rejection_reasons_public():
    return list_rejection_reasons()


@router.get("", response_model=list[QuestionResponse])
async def list_community_questions(
    subject: Optional[str] = None,
    course_level: Optional[str] = None,
    grade_level: Optional[int] = None,
    type: Optional[str] = None,
    limit: int = 50,
):
    client = get_supabase_admin()
    query = (
        client.table("questions")
        .select("*")
        .eq("validated", True)
        .eq("pool", "community")
    )

    if subject:
        query = query.eq("subject", subject)
    if course_level:
        query = query.eq("course_level", course_level)
    if grade_level is not None:
        query = query.eq("grade_level", grade_level)
    if type:
        query = query.eq("type", type)

    result = query.limit(limit).execute()
    return result.data or []


@router.post("", response_model=QuestionResponse)
async def create_question(
    question: QuestionCreate,
    authorization: str = Header(...),
):
    user_id = get_bearer_user_id(authorization)

    errors = validate_question(question)
    if errors:
        raise HTTPException(status_code=422, detail=errors)

    client = get_supabase_admin()
    data = question.model_dump(mode="json", exclude_none=True)
    data["creator_id"] = user_id
    data["validated"] = False
    data["pool"] = "personal"

    try:
        result = client.table("questions").insert(data).execute()
    except APIError as e:
        if e.code == "PGRST204":
            raise HTTPException(
                status_code=503,
                detail=(
                    "Database is missing columns the app needs (e.g. question_image_url or pool). "
                    "Run database/migration_roles_question_pool.sql and "
                    "database/patch_questions_app_columns.sql in Supabase."
                ),
            ) from e
        raise
    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to create question")

    return result.data[0]


@router.get("/{question_id}", response_model=QuestionResponse)
async def get_question(question_id: str, authorization: str = Header(...)):
    profile = fetch_profile(get_bearer_user_id(authorization))
    client = get_supabase_admin()
    row = _fetch_question_row(client, question_id)
    if not _can_view_question(profile, row):
        raise HTTPException(status_code=404, detail="Question not found")
    return row


@router.patch("/{question_id}", response_model=QuestionResponse)
async def update_question(
    question_id: str,
    body: QuestionUpdate,
    authorization: str = Header(...),
):
    profile = fetch_profile(get_bearer_user_id(authorization))
    client = get_supabase_admin()
    row = _fetch_question_row(client, question_id)
    if not _can_edit_question(profile, row):
        raise HTTPException(status_code=403, detail="Not allowed to edit this question")

    patch = body.model_dump(exclude_unset=True, mode="json")
    if not patch:
        return row

    client.table("questions").update(patch).eq("id", question_id).execute()
    return _fetch_question_row(client, question_id)


@router.delete("/{question_id}")
async def delete_question(question_id: str, authorization: str = Header(...)):
    profile = fetch_profile(get_bearer_user_id(authorization))
    client = get_supabase_admin()
    row = _fetch_question_row(client, question_id)
    if not _can_delete_question(profile, row):
        raise HTTPException(status_code=403, detail="Not allowed to delete this question")

    client.table("questions").delete().eq("id", question_id).execute()
    return {"status": "deleted", "id": question_id}


@router.post("/{question_id}/submit-for-review", response_model=QuestionResponse)
async def submit_question_for_review(question_id: str, authorization: str = Header(...)):
    user_id = get_bearer_user_id(authorization)
    client = get_supabase_admin()
    row = _fetch_question_row(client, question_id)
    if str(row.get("creator_id") or "") != str(user_id):
        raise HTTPException(status_code=403, detail="Not your question")
    if row.get("pool") != "personal":
        raise HTTPException(
            status_code=400,
            detail="Only personal bank questions can be submitted for review.",
        )

    client.table("questions").update(
        {"pool": "community_pending", "validated": False, "rejection_reason": None}
    ).eq("id", question_id).execute()
    return _fetch_question_row(client, question_id)


@router.post("/{question_id}/approve", response_model=QuestionResponse)
async def approve_question(question_id: str, authorization: str = Header(...)):
    profile = fetch_profile(get_bearer_user_id(authorization))
    require_min_role(profile, "moderator")
    client = get_supabase_admin()
    row = _fetch_question_row(client, question_id)
    if row.get("pool") != "community_pending":
        raise HTTPException(
            status_code=400,
            detail="Only questions awaiting moderation can be approved.",
        )

    client.table("questions").update(
        {"pool": "community", "validated": True, "rejection_reason": None}
    ).eq("id", question_id).execute()
    updated = _fetch_question_row(client, question_id)
    grant_points_for_approved_question(client, updated)
    return updated


@router.post("/{question_id}/reject", response_model=QuestionResponse)
async def reject_question(
    question_id: str,
    body: QuestionRejectBody,
    authorization: str = Header(...),
):
    profile = fetch_profile(get_bearer_user_id(authorization))
    require_min_role(profile, "moderator")
    if body.reason not in _ALLOWED_REJECT_IDS:
        raise HTTPException(
            status_code=422,
            detail="Invalid rejection reason. Use GET /questions/rejection-reasons.",
        )
    if body.reason == "other" and not (body.explanation or "").strip():
        raise HTTPException(
            status_code=422,
            detail="Please provide a detailed explanation when choosing 'Other'.",
        )
    client = get_supabase_admin()
    row = _fetch_question_row(client, question_id)
    if row.get("pool") != "community_pending":
        raise HTTPException(
            status_code=400,
            detail="Only questions awaiting moderation can be rejected.",
        )

    label = _REJECT_LABELS[body.reason]
    if body.reason == "other" and body.explanation:
        label = f"{label}: {body.explanation.strip()}"
    client.table("questions").update(
        {"pool": "personal", "validated": False, "rejection_reason": label}
    ).eq("id", question_id).execute()
    return _fetch_question_row(client, question_id)
