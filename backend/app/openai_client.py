import base64
import json
import os
import time
from pathlib import Path
from typing import Any, Type

from dotenv import load_dotenv
from openai import OpenAI
from pydantic import BaseModel

from app.models import (
    GeneratePersonasResponse,
    GeneratedPersona,
    SimulationResultResponse,
)
from app.scoring import merge_ai_and_rules


PROJECT_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(PROJECT_ROOT / ".env")


class OpenAIRequestFailed(RuntimeError):
    def __init__(self, message: str, attempts: int):
        super().__init__(message)
        self.attempts = attempts


def _schema_for(model: Type[BaseModel]) -> dict:
    schema = model.model_json_schema()
    if model is SimulationResultResponse:
        _remove_runtime_result_fields(schema)
    if model is GeneratePersonasResponse:
        _remove_generate_personas_runtime_fields(schema)
    _make_openai_strict_schema(schema)
    return schema


GENERATE_PERSONAS_RUNTIME_FIELDS = {"requestId", "durationMs"}


RUNTIME_RESULT_FIELDS = {
    "ruleBasedChecks",
    "aiScores",
    "ruleScores",
    "finalScores",
    "adjustedScores",
    "scoreDiffs",
    "rawOpenAIResult",
    "developmentDebug",
    "openaiResponseId",
    "openaiAttempts",
    "postProcessingWarning",
}


def _remove_generate_personas_runtime_fields(schema: dict) -> None:
    properties = schema.get("properties")
    if not isinstance(properties, dict):
        return
    for field in GENERATE_PERSONAS_RUNTIME_FIELDS:
        properties.pop(field, None)


def _remove_runtime_result_fields(schema: dict) -> None:
    for definition in [schema, *schema.get("$defs", {}).values()]:
        properties = definition.get("properties")
        if not isinstance(properties, dict):
            continue
        for field in RUNTIME_RESULT_FIELDS:
            properties.pop(field, None)


def _make_openai_strict_schema(node: dict) -> None:
    if node.get("type") == "object":
        properties = node.get("properties", {})
        node["additionalProperties"] = False
        node["required"] = list(properties.keys())

    node.pop("default", None)

    for value in node.values():
        if isinstance(value, dict):
            _make_openai_strict_schema(value)
        elif isinstance(value, list):
            for item in value:
                if isinstance(item, dict):
                    _make_openai_strict_schema(item)


def _client() -> OpenAI:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not set")
    return OpenAI(
        api_key=api_key,
        timeout=_timeout_seconds(),
        max_retries=0,
    )


def _model() -> str:
    return os.getenv("OPENAI_MODEL", "gpt-5.5")


def _max_attempts() -> int:
    return max(1, int(os.getenv("OPENAI_MAX_ATTEMPTS", "1")))


def _timeout_seconds() -> float:
    return max(1.0, float(os.getenv("OPENAI_TIMEOUT_SECONDS", "55")))


def _retry_backoff_seconds() -> list[float]:
    raw = os.getenv("OPENAI_RETRY_BACKOFF_SECONDS", "2")
    values: list[float] = []
    for item in raw.split(","):
        try:
            values.append(max(0.0, float(item.strip())))
        except ValueError:
            continue
    return values or [2.0]


def _retry_delay(attempt: int, exc: Exception) -> float:
    configured_backoffs = _retry_backoff_seconds()
    configured = configured_backoffs[min(attempt - 1, len(configured_backoffs) - 1)]
    retry_after = _extract_retry_after(exc)
    if retry_after is not None:
        return min(retry_after, configured)
    return configured


def _extract_retry_after(exc: Exception) -> float | None:
    response = getattr(exc, "response", None)
    headers = getattr(response, "headers", None)
    if headers:
        value = headers.get("retry-after") or headers.get("Retry-After")
        if value:
            try:
                return float(value)
            except ValueError:
                return None
    body = getattr(exc, "body", None)
    if isinstance(body, dict):
        value = body.get("retry_after")
        if isinstance(value, (int, float)):
            return float(value)
    return None


def _status_code(exc: Exception) -> int | None:
    status_code = getattr(exc, "status_code", None)
    if isinstance(status_code, int):
        return status_code
    body = getattr(exc, "body", None)
    if isinstance(body, dict):
        status = body.get("status") or body.get("error_code")
        if isinstance(status, int):
            return status
    return None


def _is_transient_openai_error(exc: Exception) -> bool:
    status_code = _status_code(exc)
    if status_code in {408, 409, 429, 500, 502, 503, 504, 520, 522, 524}:
        return True
    lower = str(exc).lower()
    return any(
        marker in lower
        for marker in [
            "timeout",
            "timed out",
            "connection error",
            "temporarily unavailable",
            "unknown_origin_error",
            "cloudflare",
        ]
    )


def _metadata(
    request_id: str | None,
    endpoint: str,
    persona_count: int | None = None,
    image_uploaded: bool | None = None,
) -> dict[str, str]:
    metadata: dict[str, str] = {"endpoint": endpoint}
    if request_id:
        metadata["requestId"] = request_id
    if persona_count is not None:
        metadata["personaCount"] = str(persona_count)
    if image_uploaded is not None:
        metadata["imageUploaded"] = str(image_uploaded).lower()
    return metadata


def _responses_create_with_retry(
    request_id: str | None,
    endpoint: str,
    persona_count: int | None,
    image_uploaded: bool | None,
    **kwargs: Any,
) -> tuple[Any, int]:
    kwargs["metadata"] = _metadata(
        request_id=request_id,
        endpoint=endpoint,
        persona_count=persona_count,
        image_uploaded=image_uploaded,
    )
    max_attempts = _max_attempts()
    last_error: Exception | None = None
    for attempt in range(1, max_attempts + 1):
        try:
            return _client().responses.create(**kwargs), attempt
        except Exception as exc:
            last_error = exc
            if attempt >= max_attempts or not _is_transient_openai_error(exc):
                raise OpenAIRequestFailed(str(exc), attempt) from exc
            time.sleep(_retry_delay(attempt, exc))
    raise RuntimeError("OpenAI request failed without an exception") from last_error


def _image_part(image_bytes: bytes, content_type: str) -> dict:
    encoded = base64.b64encode(image_bytes).decode("ascii")
    return {
        "type": "input_image",
        "image_url": f"data:{content_type};base64,{encoded}",
    }


def generate_personas_with_openai(
    feature_name: str,
    banking_message: str,
    target_customers: str,
    channel: str,
    send_timing: str,
    persona_count: int,
    request_id: str | None = None,
) -> GeneratePersonasResponse:
    prompt = f"""
Generate exactly {persona_count} synthetic banking personas for an early pre-launch
feature, message, and UI risk review. Return valid JSON only.

Feature name: {feature_name}
Feature context and customer-facing copy: {banking_message}
Target customer segment: {target_customers}
Where shown / channel: {channel}
Trigger point / when shown: {send_timing}

Requirements:
- Generate exactly personaCount personas.
- Personas must be realistic and banking-relevant.
- Avoid stereotypes, protected-attribute assumptions, extreme stories, and dramatic
  personal details.
- Vary income pattern, bill pressure, digital confidence, language/accessibility need,
  financial stress, privacy sensitivity, and support need.
- Focus on product interaction needs and financial behaviour.
- Use ids persona_1, persona_2, and so on.
- Every persona must include exactly these fields:
  id, name, ageRange, shortLabel, tags, lifeContext, incomePattern,
  digitalConfidence, languageNeed, accessibilityNeed, financialStress,
  privacySensitivity, bankingContext, mainConcern, likelyMisunderstanding,
  supportNeed, custom.
- Use age ranges only: 18-24, 25-34, 35-44, 45-54, 55-64, 65-74, 75+.
- Do not use "Synthetic" as ageRange.
- tags must be an array of strings using relevant values such as Everyday customer,
  Financial vulnerability, Irregular income, Low digital confidence,
  English as an additional language, Accessibility needs, Older customers,
  New-to-bank customers, Shared household finances, Privacy-sensitive,
  Small business overlap, Rural or limited connectivity, Operational risk.
- financialStress, privacySensitivity, digitalConfidence, languageNeed must be Low,
  Medium, or High.
- accessibilityNeed must be None, Low, Medium, or High.
- mainConcern should describe the customer's main worry about this feature.
- likelyMisunderstanding should describe what they may misunderstand.
- supportNeed should describe what support or UI clarity they need.
- custom must be false.
"""
    response, _attempts = _responses_create_with_retry(
        request_id=request_id,
        endpoint="generate-personas",
        persona_count=persona_count,
        image_uploaded=False,
        model=_model(),
        input=[{"role": "user", "content": [{"type": "input_text", "text": prompt}]}],
        text={
            "format": {
                "type": "json_schema",
                "name": "generate_personas_response",
                "schema": _schema_for(GeneratePersonasResponse),
                "strict": True,
            }
        },
    )
    parsed = GeneratePersonasResponse.model_validate_json(response.output_text)
    parsed.used_openai = True
    parsed.fallback_reason = None
    return parsed


def simulate_with_openai(
    personas: list[GeneratedPersona],
    feature_name: str,
    banking_message: str,
    target_customers: str,
    channel: str,
    send_timing: str,
    image_bytes: bytes | None,
    image_content_type: str | None,
    request_id: str | None = None,
) -> SimulationResultResponse:
    content: list[dict] = [
        {
            "type": "input_text",
            "text": _simulation_prompt(
                personas=personas,
                feature_name=feature_name,
                banking_message=banking_message,
                target_customers=target_customers,
                channel=channel,
                send_timing=send_timing,
                has_image=image_bytes is not None,
            ),
        }
    ]
    if image_bytes and image_content_type:
        content.append(_image_part(image_bytes, image_content_type))

    response, attempts = _responses_create_with_retry(
        request_id=request_id,
        endpoint="run-simulation",
        persona_count=len(personas),
        image_uploaded=image_bytes is not None,
        model=_model(),
        input=[{"role": "user", "content": content}],
        text={
            "format": {
                "type": "json_schema",
                "name": "simulation_result_response",
                "schema": _schema_for(SimulationResultResponse),
                "strict": True,
            }
        },
    )
    parsed = SimulationResultResponse.model_validate_json(response.output_text)
    parsed.used_openai = True
    parsed.fallback_reason = None
    parsed.openaiResponseId = getattr(response, "id", None)
    parsed.openaiAttempts = attempts
    try:
        merged = merge_ai_and_rules(
            ai_result=parsed,
            personas=personas,
            message=banking_message,
            target_customers=target_customers,
            feature_name=feature_name,
            channel=channel,
            send_timing=send_timing,
            image_uploaded=image_bytes is not None,
        )
        return merged.model_copy(
            update={
                "openaiResponseId": parsed.openaiResponseId,
                "openaiAttempts": attempts,
            }
        )
    except Exception as exc:
        raw_openai_result = parsed.model_dump(
            exclude={
                "developmentDebug",
                "rawOpenAIResult",
                "openaiResponseId",
                "openaiAttempts",
                "postProcessingWarning",
            }
        )
        return parsed.model_copy(
            update={
                "rawOpenAIResult": raw_openai_result,
                "openaiResponseId": parsed.openaiResponseId,
                "openaiAttempts": attempts,
                "postProcessingWarning": f"post_processing_error: {exc}",
                "used_openai": True,
                "fallback_reason": None,
            }
        )


def _simulation_prompt(
    personas: list[GeneratedPersona],
    feature_name: str,
    banking_message: str,
    target_customers: str,
    channel: str,
    send_timing: str,
    has_image: bool,
) -> str:
    return f"""
You are helping a BNZ product team run an early synthetic pre-launch risk review.
Return valid JSON only.

Do not claim these synthetic personas represent real customers. Do not describe this
as a replacement for real customer testing. Focus on making banking simpler, easier,
more accessible, more supportive, and less stressful.

Feature name: {feature_name}
Banking message: {banking_message}
Target customers: {target_customers}
Channel: {channel}
Send timing: {send_timing}
Image uploaded: {has_image}

Generated personas JSON:
{json.dumps([persona.model_dump() for persona in personas], indent=2)}

For each persona:
- Use the given persona fields and id.
- Explain likely reaction from that persona's perspective.
- Include AI qualitative judgement in mainIssues and suggestedImprovement.
- Leave triggeredRules empty unless the rule is clearly implied. The backend will add
  deterministic rule-based risks separately after your response.
- Scores are 0-100 where higher risk fields mean higher risk.
- Include privacyRisk. For mobile app notifications, consider whether lock-screen
  previews could disclose sensitive financial information.

If an image is present, analyze visible text, visual hierarchy, button clarity,
warning placement, accessibility risk, and user action clarity in uiScreenshotAnalysis.
If no image is present, set uiScreenshotAnalysis to null.
"""
