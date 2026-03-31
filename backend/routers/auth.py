from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel, EmailStr
from database import get_supabase_client
from services.authz import get_bearer_user_id, fetch_profile
from schemas.profile import ProfileResponse, profile_response_from_row

router = APIRouter()


class AuthRequest(BaseModel):
    email: EmailStr
    password: str


class AuthResponse(BaseModel):
    access_token: str
    user_id: str
    email: str


@router.post("/signup", response_model=AuthResponse)
async def signup(req: AuthRequest):
    client = get_supabase_client()
    try:
        result = client.auth.sign_up({"email": req.email, "password": req.password})
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    if not result.user:
        raise HTTPException(status_code=400, detail="Signup failed")

    return AuthResponse(
        access_token=result.session.access_token if result.session else "",
        user_id=result.user.id,
        email=result.user.email,
    )


@router.post("/login", response_model=AuthResponse)
async def login(req: AuthRequest):
    client = get_supabase_client()
    try:
        result = client.auth.sign_in_with_password(
            {"email": req.email, "password": req.password}
        )
    except Exception as e:
        raise HTTPException(status_code=401, detail=str(e))

    if not result.user or not result.session:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    return AuthResponse(
        access_token=result.session.access_token,
        user_id=result.user.id,
        email=result.user.email,
    )


@router.get("/me", response_model=ProfileResponse)
async def get_me(authorization: str = Header(...)):
    uid = get_bearer_user_id(authorization)
    profile = fetch_profile(uid)
    return profile_response_from_row(profile)
