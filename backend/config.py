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
    openai_model: str = "gpt-5.4-mini-2026-03-17"

    # Ollama fallback
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "llama3"

    # Include 127.0.0.1 — browsers treat it as a different origin than "localhost".
    cors_origins: list[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "https://cram-academy.vercel.app"
    ]

    extraction_enabled: bool = True
    extraction_max_pages: int = 24
    extraction_max_image_edge_px: int = 1920
    extraction_high_accuracy_max_edge_px: int = 2560
    # Downscale each page image on the analyze-stream wire (separate NDJSON lines).
    # Keeps each line small; normalized region boxes still match the streamed image.
    # Set to 0 to send full vision resolution per page (still split across N lines).
    extraction_stream_page_image_max_edge_px: int = 1024
    extraction_stream_page_use_jpeg: bool = True
    extraction_stream_page_jpeg_quality: int = 82
    # Max base64 characters per NDJSON line (page_image_part / result_b64_part).
    extraction_stream_b64_chunk_chars: int = 65536
    # Above this JSON character count, send result as result_b64_* chunks.
    extraction_stream_result_json_char_threshold: int = 180_000
    extraction_default_dpi: int = 160
    extraction_page_concurrency: int = 4
    # Vision model (falls back to openai_model)
    extraction_model: str = ""
    # low | high | auto — passed to image_url when supported
    extraction_image_detail: str = "high"
    # httpx read timeout per upstream OpenAI-compatible call (seconds)
    extraction_openai_read_timeout_seconds: float = 180.0
    extraction_use_json_schema: bool = True
    extraction_two_stage_default: bool = False
    # Local Ollama: json_schema is often flaky; prefer json_object for vision extraction.
    extraction_ollama_prefer_json_object: bool = True
    # Run layout-first pass by default when using Ollama (more reliable JSON on page 2).
    extraction_ollama_two_stage_default: bool = True
    extraction_pdf_text_hint: bool = True
    extraction_cross_page_warnings: bool = True
    # Skip vision on detected answer sheets, directions, keys, scoring (AP-style PDF text layer).
    extraction_skip_noncontent_pages: bool = True
    # Re-render selected pages at higher DPI when structural validation fails (Calculus MCQ).
    extraction_auto_retry_fail_pages: bool = True
    extraction_retry_dpi_min: int = 220

    class Config:
        env_file = ".env"


@lru_cache
def get_settings() -> Settings:
    return Settings()
