from pydantic import BaseModel, Field
from typing import Optional


class SubjectCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    levels: list[str] = Field(default_factory=list)
    position: int = 0


class SubjectUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    levels: Optional[list[str]] = None
    position: Optional[int] = None


class SubjectResponse(BaseModel):
    id: str
    name: str
    levels: list[str]
    position: int
    created_at: str
