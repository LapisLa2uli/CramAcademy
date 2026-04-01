import time
from fastapi import HTTPException
import httpx
import jwt
from gotrue.errors import AuthApiError, AuthRetryableError

from config import get_settings
from database import get_supabase_admin, get_supabase_client


ROLE_RANK = {"user": 0, "moderator": 1, "admin": 2}


def role_rank(role: str | None) -> int:
    return ROLE_RANK.get((role or "user").lower(), 0)


def _user_id_from_jwt_local(token: str) -> str | None:
    """Return user id if JWT_SECRET verifies the token locally.

    If local verification fails for any reason except expiry (wrong secret, audience mismatch,
    etc.), return None so :func:`get_bearer_user_id` can fall back to Supabase ``get_user``,
    which validates the JWT against the same project as ``SUPABASE_URL`` / ``SUPABASE_ANON_KEY``.
    Relying only on local decode when ``SUPABASE_JWT_SECRET`` is slightly wrong produced
    endless 'Invalid token' even though signup and profiles worked.
    """
    secret = get_settings().supabase_jwt_secret.strip()
    if not secret:
        return None
    try:
        payload = jwt.decode(
            token,
            secret,
            algorithms=["HS256"],
            audience="authenticated",
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired") from None
    except jwt.PyJWTError:
        return None
    sub = payload.get("sub")
    if not sub:
        return None
    return str(sub)


def get_bearer_user_id(authorization: str) -> str:
    token = authorization.replace("Bearer ", "").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Invalid token")

    local_id = _user_id_from_jwt_local(token)
    if local_id is not None:
        return local_id

    client = get_supabase_client()
    last_exc: Exception | None = None
    for attempt in range(3):
        try:
            user = client.auth.get_user(token)
            if not user or not user.user:
                raise HTTPException(status_code=401, detail="Invalid token")
            return user.user.id
        except HTTPException:
            raise
        except AuthApiError as e:
            raise HTTPException(status_code=401, detail="Invalid token") from e
        except (AuthRetryableError, httpx.ConnectError, httpx.ReadTimeout, httpx.RemoteProtocolError) as e:
            last_exc = e
            time.sleep(0.2 * (attempt + 1))
    raise HTTPException(
        status_code=503,
        detail=(
            "Supabase Auth did not respond. Add SUPABASE_JWT_SECRET to backend/.env "
            "(Supabase → Project Settings → API → JWT Secret) so the API can verify "
            "your session without calling Auth over the network."
        ),
    ) from last_exc


def fetch_profile(user_id: str) -> dict:
    admin = get_supabase_admin()
    result = admin.table("profiles").select("*").eq("id", user_id).execute()
    if not result.data:
        raise HTTPException(status_code=401, detail="Profile not found")
    return result.data[0]


def require_min_role(profile: dict, minimum: str) -> None:
    if role_rank(profile.get("role")) < role_rank(minimum):
        raise HTTPException(
            status_code=403,
            detail=f"This action requires the {minimum} role.",
        )
