from typing import Any, TypedDict


class StitchEvent(TypedDict):
    """Debug info about one cross-page set merge.

    ``source_page_indices`` lists pages that were pulled into the merged set
    (earlier side first), ``reason`` records which continuation flag triggered
    it, and ``question_bridge`` is true when the first question of the later
    page was joined with the last question of the earlier page (i.e. a single
    question that spanned the page break).
    """

    target_set_index: int
    source_page_indices: list[int]
    reason: str
    question_bridge: bool

from schemas.extraction import (
    ExtractionPage,
    ExtractionRegion,
    ExtractionSetDraft,
    ExtractionQuestionDraft,
    SharedStemDraft,
    NormRect,
)
from services.extraction.latex_normalize import normalize_options, unicode_to_latex


def _coerce_bool(v: Any, default: bool = False) -> bool:
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return bool(v)
    if isinstance(v, str):
        s = v.strip().lower()
        if s in ("true", "yes", "1", "t", "y"):
            return True
        if s in ("false", "no", "0", "f", "n", ""):
            return False
    return default


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
        raw_text = r.get("text") if isinstance(r.get("text"), str) else None
        out.append(
            ExtractionRegion(
                id=str(r.get("id") or f"p{page_index}-r{i}"),
                page_index=page_index,
                role=role,  # type: ignore[arg-type]
                label=str(r.get("label") or role),
                bbox=_norm_bbox(r.get("bbox")),
                text=unicode_to_latex(raw_text) if raw_text is not None else None,
                set_index=gid,
                question_index=_coerce_optional_int(qidx),
                choice_label=str(r["choice_label"]) if r.get("choice_label") not in (None, "null") else None,
                applies_to_question_numbers=list(applies) if isinstance(applies, list) else None,
                confidence=float(r["confidence"]) if r.get("confidence") is not None else None,
            )
        )
    return out


def _parse_set(
    raw: dict[str, Any],
    global_set_index: int,
    page_index: int,
) -> ExtractionSetDraft:
    qs: list[ExtractionQuestionDraft] = []
    for q in raw.get("questions") or []:
        if not isinstance(q, dict):
            continue
        raw_opts = q.get("options") if isinstance(q.get("options"), list) else None
        qs.append(
            ExtractionQuestionDraft(
                question_index=_coerce_int(q.get("question_index"), len(qs) + 1),
                type="mcq" if q.get("type") == "mcq" else "frq",
                content=unicode_to_latex(str(q.get("content") or "")),
                options=normalize_options(raw_opts),
                answer=unicode_to_latex(str(q.get("answer") or "")),
                explanation=unicode_to_latex(str(q.get("explanation"))) if q.get("explanation") else None,
                rubric=q.get("rubric") if isinstance(q.get("rubric"), dict) else None,
                continued_from_previous_page=_coerce_bool(q.get("continued_from_previous_page")),
                continues_on_next_page=_coerce_bool(q.get("continues_on_next_page")),
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
                text=unicode_to_latex(str(s.get("text") or "")),
            )
        )
    return ExtractionSetDraft(
        set_index=global_set_index,
        context_text=unicode_to_latex(str(raw.get("context_text") or "")),
        shared_stems=stems,
        questions=qs,
        continued_from_previous_page=_coerce_bool(raw.get("continued_from_previous_page")),
        continues_on_next_page=_coerce_bool(raw.get("continues_on_next_page")),
        source_page_indices=[page_index],
    )


def merge_page_results(
    page_results: list[tuple[int, dict[str, Any], bytes, int, int]],
) -> tuple[list[ExtractionPage], list[ExtractionSetDraft], list[StitchEvent]]:
    """
    page_results: (page_index, raw_json, png_bytes, width, height)

    Builds per-page ``ExtractionPage`` records and a flat list of
    ``ExtractionSetDraft`` spanning the whole document. Adjacent-page sets
    flagged as continuations are stitched together before being returned.
    The third return value is a list of :class:`StitchEvent` records describing
    each cross-page merge performed (empty when nothing was stitched).
    """
    all_sets: list[ExtractionSetDraft] = []
    pages_out: list[ExtractionPage] = []
    sets_by_page: dict[int, list[int]] = {}

    for page_index, raw, png_bytes, w, h in page_results:
        regions_raw = raw.get("regions") if isinstance(raw.get("regions"), list) else []
        sets_raw = raw.get("sets") if isinstance(raw.get("sets"), list) else []

        set_id_map: dict[int, int] = {}
        page_set_gids: list[int] = []

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
                        source_page_indices=[page_index],
                    )
                )
                page_set_gids.append(gid)
            return set_id_map[local_sid]

        for s in sets_raw:
            if not isinstance(s, dict):
                continue
            local = _coerce_int(s.get("set_index"), 0)
            gid = ensure_local_set(local)
            parsed = _parse_set(s, gid, page_index)
            all_sets[gid] = parsed

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
        sets_by_page[page_index] = page_set_gids

    all_sets, stitch_events = _stitch_cross_page_sets(all_sets, sets_by_page)
    return pages_out, all_sets, stitch_events


def _stitch_cross_page_sets(
    sets: list[ExtractionSetDraft],
    sets_by_page: dict[int, list[int]],
) -> tuple[list[ExtractionSetDraft], list[StitchEvent]]:
    """Merge adjacent-page sets that the model flagged as continuations.

    A set on page N is merged into the last set on page N-1 when EITHER the
    later set has ``continued_from_previous_page=True`` OR the earlier set has
    ``continues_on_next_page=True``. Question continuation flags on the first
    question of the later set also merge that question's content into the last
    question of the earlier set (for questions cut across a page break).

    Returns ``(stitched_sets, stitch_events)``. The events list records one
    entry per merge and is meant for surface-level debug/progress UI.
    """
    events: list[StitchEvent] = []
    if not sets or len(sets_by_page) < 2:
        return sets, events

    pages_sorted = sorted(sets_by_page.keys())
    # Track which global set ids have been absorbed into an earlier set.
    absorbed: set[int] = set()
    # Remap gid -> surviving gid (follow-the-chain via path compression).
    redirect: dict[int, int] = {}

    def resolve(gid: int) -> int:
        seen = []
        while gid in redirect:
            seen.append(gid)
            gid = redirect[gid]
        for g in seen:
            redirect[g] = gid
        return gid

    for i in range(1, len(pages_sorted)):
        prev_page = pages_sorted[i - 1]
        cur_page = pages_sorted[i]
        prev_gids = [g for g in sets_by_page.get(prev_page, []) if g not in absorbed]
        cur_gids = [g for g in sets_by_page.get(cur_page, []) if g not in absorbed]
        if not prev_gids or not cur_gids:
            continue

        last_prev_gid = resolve(prev_gids[-1])
        first_cur_gid = resolve(cur_gids[0])
        if last_prev_gid == first_cur_gid:
            continue

        last_prev = sets[last_prev_gid]
        first_cur = sets[first_cur_gid]

        if not (last_prev.continues_on_next_page or first_cur.continued_from_previous_page):
            continue

        # Figure out which flag(s) drove the decision before we mutate last_prev.
        reasons: list[str] = []
        if last_prev.continues_on_next_page:
            reasons.append("prev.continues_on_next_page")
        if first_cur.continued_from_previous_page:
            reasons.append("next.continued_from_previous_page")
        question_bridge = bool(
            last_prev.questions
            and first_cur.questions
            and (
                last_prev.questions[-1].continues_on_next_page
                or first_cur.questions[0].continued_from_previous_page
            )
        )
        pre_merge_pages = list(last_prev.source_page_indices)

        _merge_set_into(last_prev, first_cur)
        absorbed.add(first_cur_gid)
        redirect[first_cur_gid] = last_prev_gid

        events.append(
            StitchEvent(
                target_set_index=last_prev_gid,  # renumbered below
                source_page_indices=sorted(set(pre_merge_pages + first_cur.source_page_indices)),
                reason=" + ".join(reasons),
                question_bridge=question_bridge,
            )
        )

    if not absorbed:
        return sets, events

    # Build the surviving list, preserving original order, and renumber.
    # Track old-gid -> new-index so stitch events can point at the final set.
    survivors: list[ExtractionSetDraft] = []
    old_to_new: dict[int, int] = {}
    for idx, s in enumerate(sets):
        if idx in absorbed:
            continue
        old_to_new[idx] = len(survivors)
        survivors.append(s)
    for new_idx, s in enumerate(survivors):
        s.set_index = new_idx
    for ev in events:
        old_gid = ev["target_set_index"]
        # follow the redirect chain in case the survivor absorbed further merges
        final_old = old_gid
        while final_old in redirect:
            final_old = redirect[final_old]
        ev["target_set_index"] = old_to_new.get(final_old, final_old)
    return survivors, events


def _merge_set_into(dst: ExtractionSetDraft, src: ExtractionSetDraft) -> None:
    """In-place merge ``src`` (later page) into ``dst`` (earlier page)."""
    # Context text: concatenate when both have content.
    if src.context_text:
        if dst.context_text:
            dst.context_text = (dst.context_text.rstrip() + " " + src.context_text.lstrip()).strip()
        else:
            dst.context_text = src.context_text

    # Shared stems: append src stems that aren't exact duplicates of dst stems.
    existing = {(tuple(s.applies_to_question_numbers), s.text) for s in dst.shared_stems}
    for s in src.shared_stems:
        key = (tuple(s.applies_to_question_numbers), s.text)
        if key not in existing:
            dst.shared_stems.append(s)
            existing.add(key)

    # Questions: if the first src question is a continuation of the last dst
    # question, merge that pair before appending the rest.
    src_questions = list(src.questions)
    if (
        src_questions
        and dst.questions
        and (src_questions[0].continued_from_previous_page or dst.questions[-1].continues_on_next_page)
    ):
        _merge_question_into(dst.questions[-1], src_questions[0])
        src_questions = src_questions[1:]

    # Remaining src questions: append with re-numbered question_index so we
    # don't collide with dst's numbering (the printed numbers usually continue
    # naturally, but this is a safe fallback).
    next_index = (max((q.question_index for q in dst.questions), default=0) + 1) if dst.questions else 1
    for q in src_questions:
        if any(eq.question_index == q.question_index for eq in dst.questions):
            q.question_index = next_index
        next_index = max(next_index, q.question_index) + 1
        dst.questions.append(q)

    # Flags: the merged set continues-on-next-page only if the src side does.
    dst.continues_on_next_page = src.continues_on_next_page
    # continued_from_previous_page stays as dst's value (its left edge).

    # Track source pages for downstream debugging/warnings.
    for p in src.source_page_indices:
        if p not in dst.source_page_indices:
            dst.source_page_indices.append(p)
    dst.source_page_indices.sort()


def _merge_question_into(dst: ExtractionQuestionDraft, src: ExtractionQuestionDraft) -> None:
    """Merge a continuation question ``src`` into the prior-page question ``dst``."""
    if src.content:
        dst.content = (dst.content.rstrip() + " " + src.content.lstrip()).strip() if dst.content else src.content
    # Options: prefer dst's options if present, else take src's; if both have
    # options, append any src options whose labels are missing from dst.
    if src.options:
        if not dst.options:
            dst.options = list(src.options)
        else:
            have = {str(o.get("label")) for o in dst.options if isinstance(o, dict)}
            for o in src.options:
                if isinstance(o, dict) and str(o.get("label")) not in have:
                    dst.options.append(o)
                    have.add(str(o.get("label")))
    if src.answer and not dst.answer:
        dst.answer = src.answer
    if src.explanation:
        if dst.explanation:
            dst.explanation = (dst.explanation.rstrip() + " " + src.explanation.lstrip()).strip()
        else:
            dst.explanation = src.explanation
    if src.rubric and not dst.rubric:
        dst.rubric = src.rubric
    dst.continues_on_next_page = src.continues_on_next_page
