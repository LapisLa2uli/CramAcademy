from pydantic import BaseModel, Field
from typing import Literal, Optional
from schemas.question import DifficultyLevel, CourseLevel


class TestGenerateRequest(BaseModel):
    subject: str
    difficulty: Optional[DifficultyLevel] = None
    course_level: Optional[CourseLevel] = None
    grade_level: Optional[int] = Field(None, ge=1, le=12)
    num_questions: int = 10
    time_limit_seconds: int = 3600
    question_source: Literal["personal", "community", "both"] = Field(
        default="both",
        description="Personal bank, shared validated community bank, or both.",
    )


class TestResponse(BaseModel):
    id: str
    user_id: str
    subject: Optional[str]
    difficulty: Optional[str]
    course_level: Optional[str] = None
    grade_level: Optional[int] = None
    time_limit_seconds: int
    started_at: Optional[str]
    finished_at: Optional[str]
    created_at: str


class TestDetailResponse(TestResponse):
    questions: list[dict]


class TestStartRequest(BaseModel):
    test_id: str
