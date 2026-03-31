from pydantic import BaseModel
from typing import Optional


class AnswerSubmission(BaseModel):
    question_id: str
    user_answer: str


class TestSubmission(BaseModel):
    test_id: str
    answers: list[AnswerSubmission]


class GradeRequest(BaseModel):
    submission_id: str


class GradeResponse(BaseModel):
    score: float
    feedback: str
    justification: str


class SubmissionResponse(BaseModel):
    id: str
    test_id: str
    question_id: str
    user_answer: str
    is_correct: Optional[bool]
    score: Optional[float]
    feedback: Optional[str]
    justification: Optional[str]
    graded_at: Optional[str]
    created_at: str
