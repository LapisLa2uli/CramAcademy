from typing import Literal, Optional

from pydantic import BaseModel, Field

PdfExamFamily = Literal[
    "marco_ap_lang",
    "college_board_ap_lang",
    "college_board_world",
    "college_board_calc",
    "college_board_generic",
    "unknown",
]

PdfPageRole = Literal[
    "exam_content",
    "answer_sheet",
    "directions",
    "answer_key",
    "scoring",
    "toc",
    "boilerplate",
]


class PdfPageSegment(BaseModel):
    page_index: int = Field(ge=0)
    role: PdfPageRole = "exam_content"
    extract_vision: bool = True


class PdfDocumentProfile(BaseModel):
    """Lightweight document profile for extraction hints, skipping, and QA."""

    family: PdfExamFamily = "unknown"
    publisher: str = ""
    signals: list[str] = Field(default_factory=list)
    expected_mcq_choice_count: int | None = None
    expected_mcq_question_count: int | None = None
    pages: list[PdfPageSegment] = Field(default_factory=list)

    def hint_for_vision(self) -> str:
        parts: list[str] = []
        parts.append(f"document_family={self.family}")
        if self.publisher:
            parts.append(f"publisher={self.publisher}")
        if self.expected_mcq_choice_count is not None:
            parts.append(f"expected_mcq_choices={self.expected_mcq_choice_count}")
        if self.expected_mcq_question_count is not None:
            parts.append(f"expected_mcq_questions={self.expected_mcq_question_count}")
        if self.family == "marco_ap_lang":
            parts.append(
                "Expect long reading passages with line numbers; MCQ usually has five choices (A–E). "
                "Section II may bundle many sources before the final essay prompt."
            )
        elif self.family == "college_board_ap_lang":
            parts.append(
                "Official AP English Language style: long reading passages (often line-referenced), "
                "rhetoric MCQs with five choices (A–E). A page may be passage-only with questions on the next page — "
                "then use context_text, empty questions[], set continues_on_next_page true. "
                "Use plain quoted prose when there is no real math; apply LaTeX only for visible equations."
            )
        elif self.family == "college_board_world":
            parts.append(
                "MCQ often begins with 'Questions X–Y refer to…' blocks; four choices (A–D). "
                "Later sections may include SAQ/DBQ/LEQ prompts with documents."
            )
        elif self.family == "college_board_calc":
            parts.append(
                "Typical layout: two-column multiple choice; heavy mathematical notation. "
                "Trust the page image over embedded PDF text for all equations."
            )
        elif self.family == "college_board_generic":
            parts.append("College Board-style layout; watch for two-column MCQ pages.")
        return "[DOCUMENT_PROFILE] " + " ".join(parts)


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
    continued_from_previous_page: bool = False
    continues_on_next_page: bool = False


class SharedStemDraft(BaseModel):
    applies_to_question_numbers: list[int] = Field(default_factory=list)
    text: str = ""


class ExtractionSetDraft(BaseModel):
    set_index: int = Field(ge=0)
    context_text: str = ""
    shared_stems: list[SharedStemDraft] = Field(default_factory=list)
    questions: list[ExtractionQuestionDraft] = Field(default_factory=list)
    continued_from_previous_page: bool = False
    continues_on_next_page: bool = False
    source_page_indices: list[int] = Field(default_factory=list)


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
    document_profile: Optional[PdfDocumentProfile] = None


class CommitQuestionItem(BaseModel):
    type: Literal["mcq", "frq"]
    content: str = ""
    question_image_url: Optional[str] = None
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
