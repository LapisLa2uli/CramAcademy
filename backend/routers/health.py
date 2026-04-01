"""Liveness endpoint for load balancers, uptime monitors, and deployment health checks."""

from fastapi import APIRouter

router = APIRouter(tags=["Health"])


@router.get("/health")
async def health_check():
    """Return 200 JSON when the API process is running."""
    return {"status": "ok", "service": "cramacademy-api"}
