"""Recover JSON from vision model output (markdown fences, preamble, truncation)."""

from __future__ import annotations

import json
import re
from typing import Any


def strip_markdown_json_fence(text: str) -> str:
    s = text.strip()
    m = re.match(r"^```(?:json)?\s*\r?\n?", s, re.IGNORECASE)
    if m:
        s = s[m.end() :]
    if s.rstrip().endswith("```"):
        s = s.rstrip()[:-3].rstrip()
    return s.strip()


def extract_balanced_json_object(text: str) -> str | None:
    """Return substring from first `{` through matching `}` or None."""
    start = text.find("{")
    if start < 0:
        return None
    depth = 0
    in_str = False
    esc = False
    quote = ""
    for i in range(start, len(text)):
        ch = text[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == quote:
                in_str = False
            continue
        if ch in "\"'":
            in_str = True
            quote = ch
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[start : i + 1]
    return None


def parse_json_from_model_output(content: str | None) -> dict[str, Any] | None:
    """
    Parse vision LLM message content into a dict.
    Handles markdown fences, leading prose, and trailing junk.
    """
    if not content or not str(content).strip():
        return None
    raw = str(content).strip()

    candidates: list[str] = []
    stripped = strip_markdown_json_fence(raw)
    candidates.append(stripped)
    if stripped != raw:
        candidates.append(raw)

    for cand in candidates:
        for chunk in (cand, extract_balanced_json_object(cand)):
            if not chunk:
                continue
            try:
                out = json.loads(chunk)
            except json.JSONDecodeError:
                continue
            if isinstance(out, dict):
                return out
    return None
