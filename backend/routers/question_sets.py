from fastapi import APIRouter, HTTPException, Header
from schemas.question import (
    QuestionSetCreate,
    QuestionSetResponse,
    QuestionSetDetailResponse,
    QuestionCreate,
    QuestionResponse,
)
from services.question_validation import validate_question
from database import get_supabase_admin
from services.authz import get_bearer_user_id

router = APIRouter()


@router.post("", response_model=QuestionSetResponse)
async def create_question_set(
    req: QuestionSetCreate,
    authorization: str = Header(...),
):
    user_id = get_bearer_user_id(authorization)
    admin = get_supabase_admin()

    result = admin.table("question_sets").insert({
        "creator_id": user_id,
        "context_text": req.context_text,
        "context_image_url": req.context_image_url,
    }).execute()

    return result.data[0]


@router.get("/{set_id}", response_model=QuestionSetDetailResponse)
async def get_question_set(
    set_id: str,
    authorization: str = Header(...),
):
    get_bearer_user_id(authorization)
    admin = get_supabase_admin()

    set_result = admin.table("question_sets").select("*").eq("id", set_id).execute()
    if not set_result.data:
        raise HTTPException(status_code=404, detail="Question set not found")

    qs = set_result.data[0]

    q_result = (
        admin.table("questions")
        .select("*")
        .eq("question_set_id", set_id)
        .order("position_in_set")
        .execute()
    )

    return {**qs, "questions": q_result.data or []}


@router.post("/{set_id}/questions", response_model=QuestionResponse)
async def add_question_to_set(
    set_id: str,
    req: QuestionCreate,
    authorization: str = Header(...),
):
    user_id = get_bearer_user_id(authorization)
    admin = get_supabase_admin()

    # Verify set exists and belongs to user
    set_result = admin.table("question_sets").select("id, creator_id").eq("id", set_id).execute()
    if not set_result.data:
        raise HTTPException(status_code=404, detail="Question set not found")
    if set_result.data[0]["creator_id"] != user_id:
        raise HTTPException(status_code=403, detail="You can only add questions to your own sets")

    validate_question(req)

    # Determine next position in set
    existing = (
        admin.table("questions")
        .select("position_in_set")
        .eq("question_set_id", set_id)
        .order("position_in_set", desc=True)
        .limit(1)
        .execute()
    )
    next_pos = 0
    if existing.data and existing.data[0].get("position_in_set") is not None:
        next_pos = existing.data[0]["position_in_set"] + 1

    data = req.model_dump(exclude_none=True)
    data["creator_id"] = user_id
    data["validated"] = False
    data["pool"] = "personal"
    data["question_set_id"] = set_id
    data["position_in_set"] = next_pos

    if "type" in data and hasattr(data["type"], "value"):
        data["type"] = data["type"].value
    if "difficulty" in data and hasattr(data["difficulty"], "value"):
        data["difficulty"] = data["difficulty"].value

    result = admin.table("questions").insert(data).execute()
    return result.data[0]


@router.delete("/{set_id}")
async def delete_question_set(
    set_id: str,
    authorization: str = Header(...),
):
    user_id = get_bearer_user_id(authorization)
    admin = get_supabase_admin()

    set_result = admin.table("question_sets").select("id, creator_id").eq("id", set_id).execute()
    if not set_result.data:
        raise HTTPException(status_code=404, detail="Question set not found")
    if set_result.data[0]["creator_id"] != user_id:
        raise HTTPException(status_code=403, detail="You can only delete your own sets")

    # Unlink questions from set (don't delete questions themselves)
    admin.table("questions").update({
        "question_set_id": None,
        "position_in_set": None,
    }).eq("question_set_id", set_id).execute()

    admin.table("question_sets").delete().eq("id", set_id).execute()

    return {"status": "deleted"}


@router.get("", response_model=list[QuestionSetDetailResponse])
async def list_my_question_sets(
    authorization: str = Header(...),
):
    user_id = get_bearer_user_id(authorization)
    admin = get_supabase_admin()

    sets_result = (
        admin.table("question_sets")
        .select("*")
        .eq("creator_id", user_id)
        .order("created_at", desc=True)
        .execute()
    )

    result = []
    for qs in sets_result.data or []:
        q_result = (
            admin.table("questions")
            .select("*")
            .eq("question_set_id", qs["id"])
            .order("position_in_set")
            .execute()
        )
        result.append({**qs, "questions": q_result.data or []})

    return result
