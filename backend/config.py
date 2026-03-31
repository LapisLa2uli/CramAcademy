from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    supabase_url: str
    supabase_anon_key: str
    supabase_service_role_key: str
    # Dashboard → Settings → API → JWT Secret (HS256). When set, the API verifies
    # bearer tokens locally and avoids calling Supabase Auth /user (fixes flaky disconnects).
    supabase_jwt_secret: str = ""

    ai_provider: str = "302ai"  # "302ai" or "ollama"

    # 302.ai (OpenAI-compatible)
    openai_api_key: str = ""
    openai_base_url: str = "https://api.302.ai/v1"
    openai_model: str = "gpt-4o"

    # Ollama fallback
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "llama3"

    # Include 127.0.0.1 — browsers treat it as a different origin than "localhost".
    cors_origins: list[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]

    class Config:
        env_file = ".env"


@lru_cache
def get_settings() -> Settings:
    return Settings()
