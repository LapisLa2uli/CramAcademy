import base64
import json
import logging
import time
from typing import Any

import httpx
from openai import AsyncOpenAI

from config import get_settings
from prompts.extraction import (
    FIX_OUTPUT_SYSTEM,
    FIX_OUTPUT_USER,
    LAYOUT_ONLY_SYSTEM,
    LAYOUT_ONLY_USER,
    PAGE_EXTRACTION_SYSTEM,
    PAGE_EXTRACTION_USER,
)

logger = logging.getLogger(__name__)

# Loose schema so providers accept it; strict=False where supported
_FULL_SCHEMA = {
    "type": "object",
    "properties": {
        "regions": {"type": "array"},
        "sets": {"type": "array"},
    },
    "required": ["regions", "sets"],
}

_LAYOUT_SCHEMA = {
    "type": "object",
    "properties": {"regions": {"type": "array"}},
    "required": ["regions"],
}


def _extraction_model() -> str:
    s = get_settings()
    return (s.extraction_model or "").strip() or s.openai_model


def _make_client() -> AsyncOpenAI:
    s = get_settings()
    timeout = httpx.Timeout(
        connect=30.0,
        read=s.extraction_openai_read_timeout_seconds,
        write=120.0,
        pool=30.0,
    )
    if s.ai_provider == "302ai":
        if not (s.openai_api_key or "").strip():
            raise RuntimeError("OPENAI_API_KEY is not configured for extraction.")
        return AsyncOpenAI(
            api_key=s.openai_api_key,
            base_url=s.openai_base_url,
            timeout=timeout,
            max_retries=1,
        )
    return AsyncOpenAI(
        api_key="ollama",
        base_url=f"{s.ollama_base_url}/v1",
        timeout=timeout,
        max_retries=1,
    )


def _image_part(data_url: str) -> dict[str, Any]:
    s = get_settings()
    detail = (s.extraction_image_detail or "high").lower()
    if detail not in ("low", "high", "auto"):
        detail = "high"
    return {
        "type": "image_url",
        "image_url": {"url": data_url, "detail": detail},
    }


def _response_format_full() -> dict[str, Any]:
    s = get_settings()
    if not s.extraction_use_json_schema:
        return {"type": "json_object"}
    return {
        "type": "json_schema",
        "json_schema": {
            "name": "page_extraction",
            "strict": False,
            "schema": _FULL_SCHEMA,
        },
    }


def _response_format_layout() -> dict[str, Any]:
    s = get_settings()
    if not s.extraction_use_json_schema:
        return {"type": "json_object"}
    return {
        "type": "json_schema",
        "json_schema": {
            "name": "page_layout",
            "strict": False,
            "schema": _LAYOUT_SCHEMA,
        },
    }


def _parse_json_content(content: str | None) -> dict[str, Any] | None:
    if not content:
        return None
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        return None


def _validate_page_payload(data: dict[str, Any]) -> list[str]:
    issues: list[str] = []
    regions = data.get("regions")
    sets = data.get("sets")
    if not isinstance(regions, list):
        issues.append('"regions" must be an array.')
    if not isinstance(sets, list):
        issues.append('"sets" must be an array.')
    if isinstance(sets, list):
        for si, s in enumerate(sets):
            if not isinstance(s, dict):
                issues.append(f"sets[{si}] is not an object.")
                continue
            qs = s.get("questions")
            if not isinstance(qs, list) or len(qs) == 0:
                issues.append(f"sets[{si}] has no questions array or it is empty.")
                continue
            for qi, q in enumerate(qs):
                if not isinstance(q, dict):
                    issues.append(f"sets[{si}].questions[{qi}] invalid.")
                    continue
                if q.get("type") == "mcq":
                    opts = q.get("options")
                    if not isinstance(opts, list) or len(opts) < 2:
                        issues.append(
                            f"sets[{si}] Q{q.get('question_index', qi)} MCQ needs at least 2 options."
                        )
    return issues


async def _chat(
    client: AsyncOpenAI,
    model: str,
    system: str,
    user_text: str,
    data_url: str,
    response_format: dict[str, Any],
) -> dict[str, Any] | None:
    try:
        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": user_text},
                        _image_part(data_url),
                    ],
                },
            ],
            temperature=0.1,
            response_format=response_format,
        )
    except Exception as e:
        # Retry without json_schema if provider rejects schema
        if response_format.get("type") == "json_schema":
            logger.warning("Schema response_format failed (%s); retrying json_object.", e)
            return await _chat(
                client, model, system, user_text, data_url, {"type": "json_object"}
            )
        raise

    content = response.choices[0].message.content
    return _parse_json_content(content)


async def _chat_fix(
    client: AsyncOpenAI,
    model: str,
    page_index: int,
    issues: list[str],
    previous: dict[str, Any],
    data_url: str,
) -> dict[str, Any] | None:
    prev_s = json.dumps(previous, ensure_ascii=False)[:14000]
    user = FIX_OUTPUT_USER.format(
        page_index=page_index,
        issues="\n".join(f"- {i}" for i in issues),
        previous_json=prev_s,
    )
    try:
        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": FIX_OUTPUT_SYSTEM},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": user},
                        _image_part(data_url),
                    ],
                },
            ],
            temperature=0.1,
            response_format={"type": "json_object"},
        )
    except Exception:
        return None
    return _parse_json_content(response.choices[0].message.content)


def _merge_layout_into_full(layout: dict[str, Any], full: dict[str, Any]) -> dict[str, Any]:
    regions = layout.get("regions")
    if isinstance(regions, list) and regions:
        out = dict(full) if isinstance(full, dict) else {}
        out["regions"] = regions
        if "sets" not in out or not isinstance(out.get("sets"), list):
            out["sets"] = full.get("sets") if isinstance(full, dict) else []
        return out
    return full


async def extract_page(
    page_index: int,
    png_bytes: bytes,
    *,
    pdf_page_text: str | None = None,
    two_stage: bool = False,
    layout_only: bool = False,
) -> tuple[dict[str, Any], list[str]]:
    """
    Returns (payload dict with regions+sets, per-page warnings).
    If layout_only, runs only the layout vision pass (regions, empty sets).
    """
    warnings: list[str] = []
    t0 = time.perf_counter()
    client = _make_client()
    model = _extraction_model()
    b64 = base64.standard_b64encode(png_bytes).decode("ascii")
    data_url = f"data:image/png;base64,{b64}"

    if layout_only:
        layout_json: dict[str, Any] | None = None
        try:
            layout_json = await _chat(
                client,
                model,
                LAYOUT_ONLY_SYSTEM,
                LAYOUT_ONLY_USER.format(page_index=page_index),
                data_url,
                _response_format_layout(),
            )
        except Exception as e:
            warnings.append(f"Page {page_index}: layout-only scan failed ({e}).")
            layout_json = None
        if layout_json and not isinstance(layout_json.get("regions"), list):
            layout_json = None
        regions = (
            layout_json.get("regions", [])
            if layout_json and isinstance(layout_json.get("regions"), list)
            else []
        )
        if not isinstance(regions, list):
            regions = []
        data: dict[str, Any] = {"regions": regions, "sets": []}
        elapsed = time.perf_counter() - t0
        logger.info(
            "extraction page=%s model=%s layout_only=True seconds=%.2f regions=%s",
            page_index,
            model,
            elapsed,
            len(data.get("regions") or []),
        )
        return data, warnings

    layout_json = None
    if two_stage:
        try:
            layout_json = await _chat(
                client,
                model,
                LAYOUT_ONLY_SYSTEM,
                LAYOUT_ONLY_USER.format(page_index=page_index),
                data_url,
                _response_format_layout(),
            )
        except Exception as e:
            warnings.append(f"Page {page_index}: layout stage failed ({e}); using single-stage.")
            layout_json = None
        if layout_json and not isinstance(layout_json.get("regions"), list):
            layout_json = None

    hint_parts: list[str] = []
    if pdf_page_text and pdf_page_text.strip():
        hint_parts.append(
            "Embedded PDF text for this page (may have ordering gaps; trust the image if they disagree):\n"
            + pdf_page_text.strip()[:8000]
        )
    if two_stage and layout_json and isinstance(layout_json.get("regions"), list):
        hint_parts.append(
            "Layout pass region boxes (JSON). Refine text and question structure; keep or adjust boxes as needed:\n"
            + json.dumps(layout_json["regions"], ensure_ascii=False)[:12000]
        )
    hint_block = "\n\n".join(hint_parts) if hint_parts else ""
    if hint_block:
        hint_block = hint_block + "\n\n"

    user_full = PAGE_EXTRACTION_USER.format(page_index=page_index, hint_block=hint_block)

    try:
        fmt = _response_format_full()
        data = await _chat(
            client,
            model,
            PAGE_EXTRACTION_SYSTEM,
            user_full,
            data_url,
            fmt,
        )
    except Exception as e:
        logger.exception("Vision extraction failed for page %s", page_index)
        raise RuntimeError(f"Vision model error on page {page_index}: {e}") from e

    if not data:
        warnings.append(
            f"Page {page_index}: model returned empty or non-JSON output — try high-accuracy mode or a smaller page range."
        )
        data = {"regions": [], "sets": []}
    else:
        if two_stage and layout_json:
            data = _merge_layout_into_full(layout_json, data)
        if not isinstance(data.get("regions"), list):
            data["regions"] = []
        if not isinstance(data.get("sets"), list):
            data["sets"] = []

        trivial_png = len(png_bytes) < 8000
        if not data["sets"] and not trivial_png:
            warnings.append(
                f"Page {page_index}: no question sets extracted — check scan quality or enable two-stage / high accuracy."
            )

        issues = _validate_page_payload(data)
        if issues:
            fixed = await _chat_fix(client, model, page_index, issues, data, data_url)
            if fixed and isinstance(fixed.get("sets"), list):
                data = fixed
            else:
                warnings.append(
                    f"Page {page_index}: validation issues remain after auto-retry: {'; '.join(issues[:3])}"
                )

    elapsed = time.perf_counter() - t0
    logger.info(
        "extraction page=%s model=%s two_stage=%s seconds=%.2f regions=%s sets=%s",
        page_index,
        model,
        two_stage,
        elapsed,
        len(data.get("regions") or []),
        len(data.get("sets") or []),
    )
    return data, warnings
