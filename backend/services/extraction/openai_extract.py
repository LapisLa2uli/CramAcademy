import base64
import json
import logging
from typing import Any

from openai import AsyncOpenAI

from config import get_settings
from prompts.extraction import PAGE_EXTRACTION_SYSTEM, PAGE_EXTRACTION_USER

logger = logging.getLogger(__name__)


async def _client_and_model() -> tuple[AsyncOpenAI, str]:
    settings = get_settings()
    if settings.ai_provider == "302ai":
        if not (settings.openai_api_key or "").strip():
            raise RuntimeError("OPENAI_API_KEY is not configured for extraction.")
        client = AsyncOpenAI(
            api_key=settings.openai_api_key,
            base_url=settings.openai_base_url,
        )
        return client, settings.openai_model
    client = AsyncOpenAI(
        api_key="ollama",
        base_url=f"{settings.ollama_base_url}/v1",
    )
    return client, settings.ollama_model


async def extract_page(page_index: int, png_bytes: bytes) -> dict[str, Any]:
    """Call vision model; return parsed JSON dict with regions + sets."""
    client, model = await _client_and_model()
    b64 = base64.standard_b64encode(png_bytes).decode("ascii")
    data_url = f"data:image/png;base64,{b64}"
    user_text = PAGE_EXTRACTION_USER.format(page_index=page_index)
    try:
        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": PAGE_EXTRACTION_SYSTEM},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": user_text},
                        {"type": "image_url", "image_url": {"url": data_url}},
                    ],
                },
            ],
            temperature=0.1,
            response_format={"type": "json_object"},
        )
    except Exception as e:
        logger.exception("Vision extraction failed for page %s", page_index)
        raise RuntimeError(f"Vision model error on page {page_index}: {e}") from e

    content = response.choices[0].message.content
    if not content:
        return {"regions": [], "sets": []}
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        logger.warning("Invalid JSON from model on page %s", page_index)
        return {"regions": [], "sets": []}
