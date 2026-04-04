from pydantic import BaseModel, Field, model_validator
from typing import Optional, Literal
from enum import Enum


class QuestionType(str, Enum):
    mcq = "mcq"
    frq = "frq"


class DifficultyLevel(str, Enum):
    easy = "easy"
    medium = "medium"
    hard = "hard"


CourseLevel = Literal["S", "S+", "H", "H+"]


class MCQOption(BaseModel):
    label: str
    text: str = ""
    image_url: Optional[str] = None

    @model_validator(mode="after")
    def text_or_image(self):
        if not self.text.strip() and not (self.image_url and self.image_url.strip()):
            raise ValueError(
                f"Option {self.label} must include text and/or an image URL."
            )
        return self


class QuestionCreate(BaseModel):
    type: QuestionType
    subject: str
    difficulty: DifficultyLevel = DifficultyLevel.medium
    course_level: Optional[CourseLevel] = None
    grade_level: Optional[int] = Field(None, ge=1, le=12)
    content: str = ""
    latex_enabled: bool = False
    question_image_url: Optional[str] = None
    options: Optional[list[MCQOption]] = None
    answer: str
    explanation: Optional[str] = None
    explanation_image_url: Optional[str] = None
    rubric: Optional[dict] = None
    tags: list[str] = Field(default_factory=list)
    question_set_id: Optional[str] = None
    position_in_set: Optional[int] = None

    @model_validator(mode="after")
    def stem_or_image(self):
        has_text = bool(self.content.strip())
        has_img = bool(self.question_image_url and self.question_image_url.strip())
        if not has_text and not has_img:
            raise ValueError("Add question text and/or upload a question image.")
        return self


class QuestionResponse(BaseModel):
    id: str
    type: QuestionType
    subject: str
    difficulty: DifficultyLevel
    course_level: Optional[str] = None
    grade_level: Optional[int] = None
    content: str
    latex_enabled: bool
    question_image_url: Optional[str] = None
    options: Optional[list[dict]] = None
    answer: Optional[str] = None
    explanation: Optional[str] = None
    explanation_image_url: Optional[str] = None
    rubric: Optional[dict] = None
    tags: list[str]
    creator_id: Optional[str] = None
    validated: bool
    pool: str = "personal"
    rejection_reason: Optional[str] = None
    question_set_id: Optional[str] = None
    position_in_set: Optional[int] = None
    created_at: str


class QuestionRejectBody(BaseModel):
    reason: str
    explanation: Optional[str] = Field(None, max_length=2000)


class QuestionUpdate(BaseModel):
    type: Optional[QuestionType] = None
    subject: Optional[str] = None
    difficulty: Optional[DifficultyLevel] = None
    course_level: Optional[CourseLevel] = None
    grade_level: Optional[int] = Field(None, ge=1, le=12)
    content: Optional[str] = None
    latex_enabled: Optional[bool] = None
    question_image_url: Optional[str] = None
    options: Optional[list[dict]] = None
    answer: Optional[str] = None
    explanation: Optional[str] = None
    explanation_image_url: Optional[str] = None
    rubric: Optional[dict] = None
    tags: Optional[list[str]] = None
    question_set_id: Optional[str] = None
    position_in_set: Optional[int] = None


# --- Question Set schemas ---

class QuestionSetCreate(BaseModel):
    context_text: str = ""
    context_image_url: Optional[str] = None

    @model_validator(mode="after")
    def text_or_image(self):
        has_text = bool(self.context_text.strip())
        has_img = bool(self.context_image_url and self.context_image_url.strip())
        if not has_text and not has_img:
            raise ValueError("A question set must have context text and/or a context image.")
        return self


class QuestionSetResponse(BaseModel):
    id: str
    creator_id: Optional[str] = None
    context_text: str
    context_image_url: Optional[str] = None
    created_at: str


class QuestionSetDetailResponse(QuestionSetResponse):
    questions: list[QuestionResponse] = []


class QuestionFilter(BaseModel):
    subject: Optional[str] = None
    difficulty: Optional[DifficultyLevel] = None
    type: Optional[QuestionType] = None
    limit: int = 50
