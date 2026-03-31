from pydantic import BaseModel
from typing import Optional


class ProtestCreate(BaseModel):
    submission_id: str
    user_argument: str


class ProtestResponse(BaseModel):
    id: str
    submission_id: str
    user_id: str
    user_argument: str
    original_score: Optional[float]
    new_score: Optional[float]
    resolution: Optional[str]
    status: str
    created_at: str
    resolved_at: Optional[str]
