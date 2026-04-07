from typing import Any

from schemas.extraction import (
    ExtractionPage,
    ExtractionRegion,
    ExtractionSetDraft,
    ExtractionQuestionDraft,
    SharedStemDraft,
    NormRect,
)


def _coerce_int(v: Any, default: int) -> int:
    """Like int(v) but treats None and invalid values as default (JSON null breaks dict.get defaults)."""
    if v is None:
        return default
    if isinstance(v, bool):
        return int(v)
    if isinstance(v, (int, float)):
        return int(v)
    if isinstance(v, str):
        s = v.strip()
        if not s:
            return default
        try:
            return int(float(s))
        except ValueError:
            return default
    return default


def _coerce_optional_int(v: Any) -> int | None:
    if v is None:
        return None
    if isinstance(v, bool):
        return int(v)
    if isinstance(v, (int, float)):
        return int(v)
    if isinstance(v, str):
        s = v.strip()
        if not s:
            return None
        try:
            return int(float(s))
        except ValueError:
            return None
    return None


def _coerce_int_list(nums: Any) -> list[int]:
    if not isinstance(nums, list):
        return []
    out: list[int] = []
    for x in nums:
        if x is None:
            continue
        try:
            out.append(int(x))
        except (TypeError, ValueError):
            continue
    return out


def _clamp01(v: float) -> float:
    return max(0.0, min(1.0, v))


def _coerce_float(v: Any, default: float) -> float:
    if v is None:
        return default
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        s = v.strip()
        if not s:
            return default
        try:
            return float(s)
        except ValueError:
            return default
    return default


def _norm_bbox(raw: dict[str, Any] | None) -> NormRect:
    if not raw:
        return NormRect(x=0, y=0, w=0.5, h=0.1)
    x = _clamp01(_coerce_float(raw.get("x"), 0.0))
    y = _clamp01(_coerce_float(raw.get("y"), 0.0))
    w = _coerce_float(raw.get("w"), 0.1)
    h = _coerce_float(raw.get("h"), 0.1)
    # Keep a small floor without inflating thin columns (0.01 was ~1% page width).
    _min = 0.002
    w = max(_min, min(1.0 - x, w))
    h = max(_min, min(1.0 - y, h))
    return NormRect(x=x, y=y, w=w, h=h)


def _parse_regions(page_index: int, raw_regions: list[Any], set_id_map: dict[int, int]) -> list[ExtractionRegion]:
    out: list[ExtractionRegion] = []
    for i, r in enumerate(raw_regions or []):
        if not isinstance(r, dict):
            continue
        sid = _coerce_int(r.get("set_index"), 0)
        gid = set_id_map.get(sid, sid)
        role = str(r.get("role", "other"))
        if role not in (
            "context",
            "shared_stem",
            "question_stem",
            "choice",
            "answer_key",
            "explanation",
            "frq_prompt",
            "other",
        ):
            role = "other"
        qidx = r.get("question_index")
        applies = r.get("applies_to_question_numbers")
        out.append(
            ExtractionRegion(
                id=str(r.get("id") or f"p{page_index}-r{i}"),
                page_index=page_index,
                role=role,  # type: ignore[arg-type]
                label=str(r.get("label") or role),
                bbox=_norm_bbox(r.get("bbox")),
                text=r.get("text") if isinstance(r.get("text"), str) else None,
                set_index=gid,
                question_index=_coerce_optional_int(qidx),
                choice_label=str(r["choice_label"]) if r.get("choice_label") not in (None, "null") else None,
                applies_to_question_numbers=list(applies) if isinstance(applies, list) else None,
                confidence=float(r["confidence"]) if r.get("confidence") is not None else None,
            )
        )
    return out


def _parse_set(raw: dict[str, Any], global_set_index: int) -> ExtractionSetDraft:
    qs: list[ExtractionQuestionDraft] = []
    for q in raw.get("questions") or []:
        if not isinstance(q, dict):
            continue
        qs.append(
            ExtractionQuestionDraft(
                question_index=_coerce_int(q.get("question_index"), len(qs) + 1),
                type="mcq" if q.get("type") == "mcq" else "frq",
                content=str(q.get("content") or ""),
                options=q.get("options") if isinstance(q.get("options"), list) else None,
                answer=str(q.get("answer") or ""),
                explanation=str(q.get("explanation")) if q.get("explanation") else None,
                rubric=q.get("rubric") if isinstance(q.get("rubric"), dict) else None,
            )
        )
    stems: list[SharedStemDraft] = []
    for s in raw.get("shared_stems") or []:
        if not isinstance(s, dict):
            continue
        nums = s.get("applies_to_question_numbers")
        stems.append(
            SharedStemDraft(
                applies_to_question_numbers=_coerce_int_list(nums),
                text=str(s.get("text") or ""),
            )
        )
    return ExtractionSetDraft(
        set_index=global_set_index,
        context_text=str(raw.get("context_text") or ""),
        shared_stems=stems,
        questions=qs,
    )


def merge_page_results(
    page_results: list[tuple[int, dict[str, Any], bytes, int, int]],
) -> tuple[list[ExtractionPage], list[ExtractionSetDraft]]:
    """
    page_results: (page_index, raw_json, png_bytes, width, height)
    """
    all_sets: list[ExtractionSetDraft] = []
    pages_out: list[ExtractionPage] = []

    for page_index, raw, png_bytes, w, h in page_results:
        regions_raw = raw.get("regions") if isinstance(raw.get("regions"), list) else []
        sets_raw = raw.get("sets") if isinstance(raw.get("sets"), list) else []

        set_id_map: dict[int, int] = {}

        def ensure_local_set(local_sid: int) -> int:
            if local_sid not in set_id_map:
                gid = len(all_sets)
                set_id_map[local_sid] = gid
                all_sets.append(
                    ExtractionSetDraft(
                        set_index=gid,
                        context_text="",
                        shared_stems=[],
                        questions=[],
                    )
                )
            return set_id_map[local_sid]

        for s in sets_raw:
            if not isinstance(s, dict):
                continue
            local = _coerce_int(s.get("set_index"), 0)
            gid = ensure_local_set(local)
            all_sets[gid] = _parse_set(s, gid)

        for r in regions_raw:
            if isinstance(r, dict):
                ensure_local_set(_coerce_int(r.get("set_index"), 0))

        regions = _parse_regions(page_index, regions_raw, set_id_map)

        import base64

        b64 = base64.standard_b64encode(png_bytes).decode("ascii")
        pages_out.append(
            ExtractionPage(
                page_index=page_index,
                width_px=w,
                height_px=h,
                image_base64=b64,
                regions=regions,
            )
        )

    return pages_out, all_sets
