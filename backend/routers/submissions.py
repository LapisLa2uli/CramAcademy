from fastapi import APIRouter, HTTPException, Header, BackgroundTasks
from datetime import datetime, timezone
from schemas.submission import TestSubmission, SubmissionResponse, GradeRequest
from services.ai_grading import grade_frq
from services.rubric_utils import resolve_frq_max_score
from database import get_supabase_admin
from services.authz import get_bearer_user_id

router = APIRouter()


async def _grade_submission(submission_id: str):
    """Background task: AI-grade an FRQ submission."""
    admin = get_supabase_admin()

    sub = admin.table("submissions").select("*").eq("id", submission_id).execute()
    if not sub.data:
        return

    submission = sub.data[0]
    q = admin.table("questions").select("*").eq("id", submission["question_id"]).execute()
    if not q.data:
        return

    question = q.data[0]
    if question["type"] != "frq":
        return

    rubric = question.get("rubric") or {
        "criteria": [
            {"name": "Overall", "expectations": "Demonstrate understanding.", "points": 10}
        ],
        "max_score": 10,
    }
    max_score = resolve_frq_max_score(rubric)

    try:
        result = await grade_frq(
            question=question.get("content") or "",
            rubric=rubric,
            max_score=max_score,
            student_answer=submission["user_answer"],
        )

        score_val = float(result["score"])
        is_correct = score_val >= max_score

        admin.table("submissions").update({
            "score": score_val,
            "is_correct": is_correct,
            "feedback": result["feedback"],
            "justification": result["justification"],
            "graded_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", submission_id).execute()
    except Exception:
        admin.table("submissions").update({
            "feedback": "Grading failed. Please request a re-grade.",
        }).eq("id", submission_id).execute()


@router.post("/submit", response_model=list[SubmissionResponse])
async def submit_test(
    req: TestSubmission,
    background_tasks: BackgroundTasks,
    authorization: str = Header(...),
):
    user_id = get_bearer_user_id(authorization)
    admin = get_supabase_admin()

    test = admin.table("tests").select("*").eq("id", req.test_id).eq("user_id", user_id).execute()
    if not test.data:
        raise HTTPException(status_code=404, detail="Test not found")

    admin.table("tests").update({
        "finished_at": datetime.now(timezone.utc).isoformat()
    }).eq("id", req.test_id).execute()

    submissions = []
    for ans in req.answers:
        q = admin.table("questions").select("*").eq("id", ans.question_id).execute()
        if not q.data:
            continue
        question = q.data[0]

        is_correct = None
        score = None
        if question["type"] == "mcq":
            is_correct = ans.user_answer.strip().upper() == question["answer"].strip().upper()
            score = 1.0 if is_correct else 0.0

        sub_data = {
            "test_id": req.test_id,
            "question_id": ans.question_id,
            "user_id": user_id,
            "user_answer": ans.user_answer,
            "is_correct": is_correct,
            "score": score,
            "feedback": "Correct!" if is_correct else ("Incorrect." if is_correct is False else None),
        }

        if question["type"] == "mcq" and not is_correct:
            sub_data["feedback"] = f"Incorrect. The correct answer is {question['answer']}."

        result = admin.table("submissions").insert(sub_data).execute()
        submission = result.data[0]
        submissions.append(submission)

        if question["type"] == "frq":
            background_tasks.add_task(_grade_submission, submission["id"])

    return submissions


@router.get("/test/{test_id}", response_model=list[SubmissionResponse])
async def get_submissions(test_id: str, authorization: str = Header(...)):
    user_id = get_bearer_user_id(authorization)
    admin = get_supabase_admin()

    result = (
        admin.table("submissions")
        .select("*")
        .eq("test_id", test_id)
        .eq("user_id", user_id)
        .execute()
    )
    return result.data or []


@router.post("/grade", response_model=dict)
async def manual_grade(
    req: GradeRequest,
    background_tasks: BackgroundTasks,
    authorization: str = Header(...),
):
    get_bearer_user_id(authorization)
    background_tasks.add_task(_grade_submission, req.submission_id)
    return {"status": "grading_queued"}
