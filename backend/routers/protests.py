from fastapi import APIRouter, HTTPException, Header
from datetime import datetime, timezone
from schemas.protest import ProtestCreate, ProtestResponse
from services.ai_grading import regrade_protest
from services.rubric_utils import resolve_frq_max_score
from database import get_supabase_admin
from services.authz import get_bearer_user_id

router = APIRouter()


@router.post("", response_model=ProtestResponse)
async def create_protest(
    req: ProtestCreate,
    authorization: str = Header(...),
):
    user_id = get_bearer_user_id(authorization)
    admin = get_supabase_admin()

    sub = admin.table("submissions").select("*").eq("id", req.submission_id).eq("user_id", user_id).execute()
    if not sub.data:
        raise HTTPException(status_code=404, detail="Submission not found")

    submission = sub.data[0]

    existing = admin.table("protests").select("*").eq("submission_id", req.submission_id).execute()
    if existing.data:
        raise HTTPException(status_code=409, detail="A protest already exists for this submission")

    q = admin.table("questions").select("*").eq("id", submission["question_id"]).execute()
    if not q.data:
        raise HTTPException(status_code=404, detail="Question not found")

    question = q.data[0]
    rubric = question.get("rubric") or {
        "criteria": [
            {"name": "Overall", "expectations": "Demonstrate understanding.", "points": 10}
        ],
        "max_score": 10,
    }
    max_score = resolve_frq_max_score(rubric)

    try:
        result = await regrade_protest(
            question=question.get("content") or "",
            rubric=rubric,
            max_score=max_score,
            student_answer=submission["user_answer"],
            original_score=submission.get("score", 0),
            original_feedback=submission.get("feedback", ""),
            student_argument=req.user_argument,
        )

        new_score = result["score"]
        status = "accepted" if new_score > (submission.get("score") or 0) else "rejected"

        admin.table("submissions").update({
            "score": new_score,
            "feedback": result["feedback"],
            "justification": result["justification"],
        }).eq("id", req.submission_id).execute()

    except Exception as e:
        new_score = None
        status = "pending"
        result = {"feedback": f"Re-grading failed: {e}", "justification": ""}

    protest_data = {
        "submission_id": req.submission_id,
        "user_id": user_id,
        "user_argument": req.user_argument,
        "original_score": submission.get("score"),
        "new_score": new_score,
        "resolution": result.get("justification", ""),
        "status": status,
        "resolved_at": datetime.now(timezone.utc).isoformat() if status != "pending" else None,
    }

    protest_result = admin.table("protests").insert(protest_data).execute()
    return protest_result.data[0]


@router.get("/submission/{submission_id}", response_model=list[ProtestResponse])
async def get_protests(submission_id: str, authorization: str = Header(...)):
    user_id = get_bearer_user_id(authorization)
    admin = get_supabase_admin()

    result = (
        admin.table("protests")
        .select("*")
        .eq("submission_id", submission_id)
        .eq("user_id", user_id)
        .execute()
    )
    return result.data or []
