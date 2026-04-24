import base64
import json
import logging
import time
from typing import Any

import httpx
from openai import AsyncOpenAI

from config import get_settings
from services.extraction.json_extract import parse_json_from_model_output
from services.extraction.text_only_extract import build_text_only_fallback_payload
from prompts.extraction import (
    FIX_OUTPUT_SYSTEM,
    FIX_OUTPUT_USER,
    LAYOUT_ONLY_SYSTEM,
    LAYOUT_ONLY_USER,
    PAGE_EXTRACTION_SYSTEM,
    PAGE_EXTRACTION_USER,
    TEXT_ONLY_PAGE_SYSTEM,
    TEXT_ONLY_PAGE_USER,
    TEXT_ONLY_REORDER_SYSTEM,
    TEXT_ONLY_REORDER_USER,
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


def _text_only_model() -> str:
    s = get_settings()
    if (s.extraction_text_only_model or "").strip():
        return s.extraction_text_only_model.strip()
    if s.ai_provider == "ollama":
        return (s.ollama_model or "").strip() or "llama3"
    return s.openai_model


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
    if s.ai_provider == "ollama" and s.extraction_ollama_prefer_json_object:
        return {"type": "json_object"}
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
    if s.ai_provider == "ollama" and s.extraction_ollama_prefer_json_object:
        return {"type": "json_object"}
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
    return parse_json_from_model_output(content)


def _stem_only_continuation_set(s: dict[str, Any]) -> bool:
    """Passage on this page; MCQs expected on the following page."""
    if not isinstance(s, dict) or not s.get("continues_on_next_page"):
        return False
    ct = str(s.get("context_text") or "").strip()
    stems = s.get("shared_stems")
    has_stems = isinstance(stems, list) and any(
        isinstance(x, dict) and str(x.get("text") or "").strip() for x in stems
    )
    return bool(ct) or has_stems


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
                if _stem_only_continuation_set(s):
                    continue
                issues.append(f"sets[{si}] has no questions array or it is empty.")
                continue
            for qi, q in enumerate(qs):
                if not isinstance(q, dict):
                    issues.append(f"sets[{si}].questions[{qi}] invalid.")
                    continue
                if q.get("type") == "mcq":
                    opts = q.get("options")
                    # Continuation questions may have their stem or options on
                    # an adjacent page — skip the min-option check in that case.
                    is_continuation = bool(
                        q.get("continued_from_previous_page")
                        or q.get("continues_on_next_page")
                    )
                    if not is_continuation and (
                        not isinstance(opts, list) or len(opts) < 2
                    ):
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
    parsed = _parse_json_content(content)
    if parsed is None and content and str(content).strip():
        snippet = str(content).strip()[:400].replace("\n", " ")
        logger.warning("Vision response was not valid JSON after repair (snippet): %s", snippet)
    return parsed


async def _chat_text(
    client: AsyncOpenAI,
    model: str,
    system: str,
    user_text: str,
    response_format: dict[str, Any],
) -> dict[str, Any] | None:
    try:
        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user_text},
            ],
            temperature=0.1,
            response_format=response_format,
        )
    except Exception as e:
        if response_format.get("type") == "json_schema":
            logger.warning(
                "Text schema response_format failed (%s); retrying json_object.", e
            )
            return await _chat_text(
                client, model, system, user_text, {"type": "json_object"}
            )
        raise

    content = response.choices[0].message.content
    parsed = _parse_json_content(content)
    if parsed is None and content and str(content).strip():
        snippet = str(content).strip()[:400].replace("\n", " ")
        logger.warning(
            "Text extraction response was not valid JSON after repair (snippet): %s",
            snippet,
        )
    return parsed


async def _chat_reorder_text(
    client: AsyncOpenAI, model: str, page_index: int, raw_text: str
) -> str:
    try:
        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": TEXT_ONLY_REORDER_SYSTEM},
                {
                    "role": "user",
                    "content": TEXT_ONLY_REORDER_USER.format(
                        page_index=page_index, raw_text=raw_text[:15000]
                    ),
                },
            ],
            temperature=0.0,
        )
        out = response.choices[0].message.content
        return str(out).strip() if out else raw_text
    except Exception:
        return raw_text


async def extract_page_from_text(
    page_index: int,
    *,
    page_text: str,
    previous_page_text: str | None = None,
    next_page_text: str | None = None,
    document_profile_hint: str | None = None,
    use_llm: bool = True,
) -> tuple[dict[str, Any], list[str]]:
    warnings: list[str] = []
    text = (page_text or "").strip()
    if not text:
        return {"regions": [], "sets": []}, warnings

    t0 = time.perf_counter()
    structured: dict[str, Any] | None = None

    if use_llm:
        client = _make_client()
        model = _text_only_model()
        cleaned = await _chat_reorder_text(client, model, page_index, text)
        hint_block = document_profile_hint or "(none)"
        prev_tail = (previous_page_text or "").strip()[-1200:]
        next_head = (next_page_text or "").strip()[:1200]
        user = TEXT_ONLY_PAGE_USER.format(
            page_index=page_index,
            hint_block=hint_block,
            prev_tail=prev_tail or "(none)",
            page_text=cleaned[:14000],
            next_head=next_head or "(none)",
        )
        try:
            structured = await _chat_text(
                client,
                model,
                TEXT_ONLY_PAGE_SYSTEM,
                user,
                _response_format_full(),
            )
        except Exception as e:
            warnings.append(f"Page {page_index}: text LLM structuring failed ({e}).")

    if structured is None:
        structured, fallback_warnings = build_text_only_fallback_payload(text)
        warnings.extend([f"Page {page_index}: {w}" for w in fallback_warnings])

    if not isinstance(structured.get("regions"), list):
        structured["regions"] = []
    if not isinstance(structured.get("sets"), list):
        structured["sets"] = []

    issues = _validate_page_payload(structured)
    if issues:
        warnings.append(
            f"Page {page_index}: text-only validation issues: {'; '.join(issues[:2])}"
        )

    elapsed = time.perf_counter() - t0
    logger.info(
        "text-only extraction page=%s model=%s seconds=%.2f sets=%s",
        page_index,
        _text_only_model() if use_llm else "heuristic",
        elapsed,
        len(structured.get("sets") or []),
    )
    return structured, warnings


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
    document_profile_hint: str | None = None,
    document_family: str | None = None,
    page_pdf_role: str | None = None,
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
    if document_profile_hint and document_profile_hint.strip():
        hint_parts.append(document_profile_hint.strip()[:2000])
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
            skip_empty_set_warn = page_pdf_role in (
                "answer_sheet",
                "directions",
                "answer_key",
                "scoring",
                "toc",
                "boilerplate",
            )
            if not skip_empty_set_warn:
                if document_family in ("college_board_ap_lang", "marco_ap_lang"):
                    warnings.append(
                        f"Page {page_index}: no sets extracted. For AP English, if this page is passage-only, "
                        "the model should return one set with context_text, questions:[], and continues_on_next_page:true; "
                        "try two-stage extraction or a stronger vision model (e.g. qwen2.5vl)."
                    )
                else:
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
