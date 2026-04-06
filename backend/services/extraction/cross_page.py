"""Optional second pass: text-only consistency warnings across pages."""

import json
import logging
from typing import Any

from openai import AsyncOpenAI

from config import get_settings

logger = logging.getLogger(__name__)


async def cross_page_warning_pass(page_summaries: list[dict[str, Any]]) -> list[str]:
    """Return extra warnings; never mutates extraction structure."""
    settings = get_settings()
    if not page_summaries or len(page_summaries) < 2:
        return []

    if not (settings.openai_api_key or "").strip() and settings.ai_provider == "302ai":
        return []

    client, model = _client()
    payload = json.dumps(page_summaries, ensure_ascii=False)[:24000]
    system = (
        "You compare exam extraction summaries from multiple pages. "
        "Return ONLY valid JSON: {\"warnings\": [\"string\", ...]} — short items, max 8. "
        "Flag cross-page issues only: e.g. duplicate question numbers, context clearly split across pages, "
        "answer key referencing questions not on that page. If nothing notable, {\"warnings\": []}."
    )
    user = f"Page summaries (JSON):\n{payload}"
    try:
        r = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            temperature=0.1,
            response_format={"type": "json_object"},
            timeout=60.0,
        )
        content = r.choices[0].message.content
        if not content:
            return []
        data = json.loads(content)
        w = data.get("warnings")
        if isinstance(w, list):
            return [str(x) for x in w if x][:8]
    except Exception as e:
        logger.warning("cross_page_warning_pass failed: %s", e)
    return []


def _client() -> tuple[AsyncOpenAI, str]:
    settings = get_settings()
    if settings.ai_provider == "302ai":
        c = AsyncOpenAI(
            api_key=settings.openai_api_key,
            base_url=settings.openai_base_url,
        )
        m = settings.extraction_model.strip() or settings.openai_model
        return c, m
    return (
        AsyncOpenAI(api_key="ollama", base_url=f"{settings.ollama_base_url}/v1"),
        settings.ollama_model,
    )


def build_page_summaries(
    page_results: list[tuple[int, dict[str, Any], bytes, int, int]],
) -> list[dict[str, Any]]:
    summaries: list[dict[str, Any]] = []
    for idx, raw, _png, _w, _h in sorted(page_results, key=lambda x: x[0]):
        sets = raw.get("sets") if isinstance(raw.get("sets"), list) else []
        snips: list[str] = []
        for s in sets[:6]:
            if not isinstance(s, dict):
                continue
            ctx = str(s.get("context_text", ""))[:400]
            nq = len(s.get("questions") or []) if isinstance(s.get("questions"), list) else 0
            snips.append(f"context_len={len(ctx)} questions={nq}")
        summaries.append({"page_index": idx, "set_snippets": snips})
    return summaries
