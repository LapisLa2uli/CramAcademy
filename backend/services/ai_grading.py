import json
from openai import AsyncOpenAI
from config import get_settings
from services.rubric_utils import format_rubric_for_prompt
from prompts.grading import (
    SYSTEM_PROMPT,
    GRADING_TEMPLATE,
    PROTEST_SYSTEM_PROMPT,
    PROTEST_TEMPLATE,
)


async def _get_client() -> tuple[AsyncOpenAI, str]:
    settings = get_settings()
    if settings.ai_provider == "302ai":
        client = AsyncOpenAI(
            api_key=settings.openai_api_key,
            base_url=settings.openai_base_url,
        )
        return client, settings.openai_model

    # Ollama fallback (OpenAI-compatible API)
    client = AsyncOpenAI(
        api_key="ollama",
        base_url=f"{settings.ollama_base_url}/v1",
    )
    return client, settings.ollama_model


async def _chat(system: str, user: str) -> dict:
    client, model = await _get_client()
    response = await client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        temperature=0.1,
        response_format={"type": "json_object"},
    )
    content = response.choices[0].message.content
    return json.loads(content)


async def grade_frq(
    question: str,
    rubric: dict,
    max_score: float,
    student_answer: str,
) -> dict:
    rubric_text = format_rubric_for_prompt(rubric)
    prompt = GRADING_TEMPLATE.format(
        question=question or "(Image-only or blank stem — refer to context.)",
        rubric=rubric_text,
        max_score=max_score,
        student_answer=student_answer,
    )
    return await _chat(SYSTEM_PROMPT, prompt)


async def regrade_protest(
    question: str,
    rubric: dict,
    max_score: float,
    student_answer: str,
    original_score: float,
    original_feedback: str,
    student_argument: str,
) -> dict:
    rubric_text = format_rubric_for_prompt(rubric)
    prompt = PROTEST_TEMPLATE.format(
        question=question or "(Image-only or blank stem — refer to context.)",
        rubric=rubric_text,
        max_score=max_score,
        student_answer=student_answer,
        original_score=original_score,
        original_feedback=original_feedback,
        student_argument=student_argument,
    )
    return await _chat(PROTEST_SYSTEM_PROMPT, prompt)
