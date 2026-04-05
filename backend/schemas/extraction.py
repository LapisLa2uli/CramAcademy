from typing import Literal, Optional

from pydantic import BaseModel, Field

ExtractionRegionRole = Literal[
    "context",
    "shared_stem",
    "question_stem",
    "choice",
    "answer_key",
    "explanation",
    "frq_prompt",
    "other",
]


class NormRect(BaseModel):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    w: float = Field(gt=0, le=1)
    h: float = Field(gt=0, le=1)


class ExtractionRegion(BaseModel):
    id: str
    page_index: int = Field(ge=0)
    role: ExtractionRegionRole
    label: str = ""
    bbox: NormRect
    text: Optional[str] = None
    set_index: int = Field(ge=0, default=0)
    question_index: Optional[int] = None
    choice_label: Optional[str] = None
    applies_to_question_numbers: Optional[list[int]] = None
    confidence: Optional[float] = Field(default=None, ge=0, le=1)


class ExtractionQuestionDraft(BaseModel):
    question_index: int = Field(ge=1)
    type: Literal["mcq", "frq"]
    content: str = ""
    options: Optional[list[dict]] = None
    answer: str = ""
    explanation: Optional[str] = None
    rubric: Optional[dict] = None


class SharedStemDraft(BaseModel):
    applies_to_question_numbers: list[int] = Field(default_factory=list)
    text: str = ""


class ExtractionSetDraft(BaseModel):
    set_index: int = Field(ge=0)
    context_text: str = ""
    shared_stems: list[SharedStemDraft] = Field(default_factory=list)
    questions: list[ExtractionQuestionDraft] = Field(default_factory=list)


class ExtractionPage(BaseModel):
    page_index: int = Field(ge=0)
    width_px: int
    height_px: int
    image_base64: str
    regions: list[ExtractionRegion] = Field(default_factory=list)


class ExtractionAnalyzeResponse(BaseModel):
    warnings: list[str] = Field(default_factory=list)
    pages: list[ExtractionPage] = Field(default_factory=list)
    sets: list[ExtractionSetDraft] = Field(default_factory=list)


class CommitQuestionItem(BaseModel):
    type: Literal["mcq", "frq"]
    content: str = ""
    options: Optional[list[dict]] = None
    answer: str
    explanation: Optional[str] = None
    rubric: Optional[dict] = None
    latex_enabled: bool = False


class CommitSetItem(BaseModel):
    context_text: str = ""
    context_image_url: Optional[str] = None
    questions: list[CommitQuestionItem] = Field(default_factory=list)


class ExtractionCommitRequest(BaseModel):
    subject: str
    subject_id: Optional[str] = None
    course_level: Optional[str] = None
    grade_level: Optional[int] = Field(default=None, ge=1, le=12)
    tags: list[str] = Field(default_factory=list)
    sets: list[CommitSetItem] = Field(default_factory=list)


class ExtractionCommitResponse(BaseModel):
    created_set_ids: list[str]
    question_counts: list[int]
