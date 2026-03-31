from fastapi import APIRouter, HTTPException, Header
from datetime import datetime, timezone
from schemas.test import TestGenerateRequest, TestResponse, TestDetailResponse
from services.test_generation import generate_test_questions
from database import get_supabase_admin
from services.authz import get_bearer_user_id

router = APIRouter()


@router.post("/generate", response_model=TestDetailResponse)
async def generate_test(
    req: TestGenerateRequest,
    authorization: str = Header(...),
):
    user_id = get_bearer_user_id(authorization)

    questions = await generate_test_questions(
        user_id=user_id,
        subject=req.subject,
        difficulty=req.difficulty.value if req.difficulty else None,
        num_questions=req.num_questions,
        course_level=req.course_level,
        grade_level=req.grade_level,
        question_source=req.question_source,
    )

    if not questions:
        raise HTTPException(
            status_code=404,
            detail="No questions found matching the criteria",
        )

    admin = get_supabase_admin()

    test_result = admin.table("tests").insert({
        "user_id": user_id,
        "subject": req.subject,
        "difficulty": req.difficulty.value if req.difficulty else None,
        "course_level": req.course_level,
        "grade_level": req.grade_level,
        "time_limit_seconds": req.time_limit_seconds,
    }).execute()

    test = test_result.data[0]
    test_id = test["id"]

    test_questions = [
        {"test_id": test_id, "question_id": q["id"], "position": i}
        for i, q in enumerate(questions)
    ]
    admin.table("test_questions").insert(test_questions).execute()

    return {**test, "questions": questions}


@router.get("/{test_id}", response_model=TestDetailResponse)
async def get_test(test_id: str, authorization: str = Header(...)):
    user_id = get_bearer_user_id(authorization)
    admin = get_supabase_admin()

    test_result = admin.table("tests").select("*").eq("id", test_id).eq("user_id", user_id).execute()
    if not test_result.data:
        raise HTTPException(status_code=404, detail="Test not found")

    test = test_result.data[0]

    tq_result = (
        admin.table("test_questions")
        .select("question_id, position, questions(*)")
        .eq("test_id", test_id)
        .order("position")
        .execute()
    )

    questions = [
        {**tq["questions"], "position": tq["position"]}
        for tq in (tq_result.data or [])
    ]

    return {**test, "questions": questions}


@router.post("/{test_id}/start")
async def start_test(test_id: str, authorization: str = Header(...)):
    user_id = get_bearer_user_id(authorization)
    admin = get_supabase_admin()

    admin.table("tests").update({
        "started_at": datetime.now(timezone.utc).isoformat()
    }).eq("id", test_id).eq("user_id", user_id).execute()

    return {"status": "started"}
