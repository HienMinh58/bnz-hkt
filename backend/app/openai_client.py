import base64
import json
import logging
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Type

from dotenv import load_dotenv
from openai import OpenAI
from pydantic import BaseModel

from app.models import (
    AdAnalysisResponse,
    AdvisorChatRequest,
    AdvisorChatResponse,
    SyntheticFeatureProfilesResponse,
    GeneratePersonasResponse,
    GeneratedPersona,
    SimulationResultResponse,
)
from app.scoring import merge_ai_and_rules


PROJECT_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(PROJECT_ROOT / ".env")
logger = logging.getLogger("synthetic_customer_lab")


class OpenAIRequestFailed(RuntimeError):
    def __init__(
        self,
        message: str,
        attempts: int,
        response_ids: list[str] | None = None,
        duration_ms: int | None = None,
    ):
        super().__init__(message)
        self.attempts = attempts
        self.openai_response_ids = response_ids or []
        self.openai_duration_ms = duration_ms


@dataclass
class OpenAIResponseResult:
    response: Any
    attempts: int
    response_ids: list[str]
    duration_ms: int


def _schema_for(model: Type[BaseModel]) -> dict:
    schema = model.model_json_schema()
    if model is SimulationResultResponse:
        _remove_runtime_result_fields(schema)
    if model is GeneratePersonasResponse:
        _remove_generate_personas_runtime_fields(schema)
    if model is AdAnalysisResponse:
        _remove_ad_analysis_runtime_fields(schema)
    if model is AdvisorChatResponse:
        _remove_advisor_chat_runtime_fields(schema)
    _make_openai_strict_schema(schema)
    return schema


GENERATE_PERSONAS_RUNTIME_FIELDS = {"requestId", "durationMs"}


AD_ANALYSIS_RUNTIME_FIELDS = {
    "requestId",
    "durationMs",
    "openaiResponseId",
    "openaiAttempts",
    "openaiAttemptResponseIds",
    "openaiDurationMs",
}


RUNTIME_RESULT_FIELDS = {
    "ruleBasedChecks",
    "aiScores",
    "ruleScores",
    "finalScores",
    "adjustedScores",
    "scoreDiffs",
    "rawOpenAIResult",
    "developmentDebug",
    "requestId",
    "durationMs",
    "openaiDurationMs",
    "postProcessingDurationMs",
    "openaiResponseId",
    "openaiAttempts",
    "openaiAttemptResponseIds",
    "postProcessingWarning",
}


ADVISOR_CHAT_RUNTIME_FIELDS = {
    "requestId",
    "durationMs",
    "openaiResponseId",
    "openaiAttempts",
    "openaiAttemptResponseIds",
    "openaiDurationMs",
}


def _remove_generate_personas_runtime_fields(schema: dict) -> None:
    properties = schema.get("properties")
    if not isinstance(properties, dict):
        return
    for field in GENERATE_PERSONAS_RUNTIME_FIELDS:
        properties.pop(field, None)


def _remove_ad_analysis_runtime_fields(schema: dict) -> None:
    properties = schema.get("properties")
    if not isinstance(properties, dict):
        return
    for field in AD_ANALYSIS_RUNTIME_FIELDS:
        properties.pop(field, None)


def _remove_runtime_result_fields(schema: dict) -> None:
    for definition in [schema, *schema.get("$defs", {}).values()]:
        properties = definition.get("properties")
        if not isinstance(properties, dict):
            continue
        for field in RUNTIME_RESULT_FIELDS:
            properties.pop(field, None)


def _remove_advisor_chat_runtime_fields(schema: dict) -> None:
    properties = schema.get("properties")
    if not isinstance(properties, dict):
        return
    for field in ADVISOR_CHAT_RUNTIME_FIELDS:
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
    return 1


def _timeout_seconds() -> float:
    return max(300.0, float(os.getenv("OPENAI_TIMEOUT_SECONDS", "300")))


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
    attempt: int | None = None,
) -> dict[str, str]:
    metadata: dict[str, str] = {"endpoint": endpoint}
    if request_id:
        metadata["requestId"] = request_id
    if persona_count is not None:
        metadata["personaCount"] = str(persona_count)
    if image_uploaded is not None:
        metadata["imageUploaded"] = str(image_uploaded).lower()
    if attempt is not None:
        metadata["attempt"] = str(attempt)
    return metadata


def _responses_create_with_retry(
    request_id: str | None,
    endpoint: str,
    persona_count: int | None,
    image_uploaded: bool | None,
    **kwargs: Any,
) -> OpenAIResponseResult:
    max_attempts = _max_attempts()
    timeout_seconds = _timeout_seconds()
    overall_started_at = time.perf_counter()
    response_ids: list[str] = []
    last_error: Exception | None = None
    for attempt in range(1, max_attempts + 1):
        attempt_kwargs = {
            **kwargs,
            "metadata": _metadata(
                request_id=request_id,
                endpoint=endpoint,
                persona_count=persona_count,
                image_uploaded=image_uploaded,
                attempt=attempt,
            ),
        }
        attempt_started_at = time.perf_counter()
        logger.info(
            "openai_attempt_start requestId=%s endpoint=%s attempt=%s maxAttempts=%s "
            "timeoutSeconds=%s timestamp=%s",
            request_id,
            endpoint,
            attempt,
            max_attempts,
            timeout_seconds,
            time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        )
        try:
            response = _client().responses.create(**attempt_kwargs)
            response_id = getattr(response, "id", None)
            if response_id:
                response_ids.append(response_id)
            logger.info(
                "openai_attempt_end requestId=%s endpoint=%s attempt=%s "
                "durationMs=%s success=True responseId=%r timestamp=%s",
                request_id,
                endpoint,
                attempt,
                int((time.perf_counter() - attempt_started_at) * 1000),
                response_id,
                time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            )
            return OpenAIResponseResult(
                response=response,
                attempts=attempt,
                response_ids=response_ids,
                duration_ms=int((time.perf_counter() - overall_started_at) * 1000),
            )
        except Exception as exc:
            last_error = exc
            logger.info(
                "openai_attempt_end requestId=%s endpoint=%s attempt=%s "
                "durationMs=%s success=False transient=%s error=%r timestamp=%s",
                request_id,
                endpoint,
                attempt,
                int((time.perf_counter() - attempt_started_at) * 1000),
                _is_transient_openai_error(exc),
                str(exc),
                time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            )
            if attempt >= max_attempts or not _is_transient_openai_error(exc):
                raise OpenAIRequestFailed(
                    str(exc),
                    attempt,
                    response_ids=response_ids,
                    duration_ms=int((time.perf_counter() - overall_started_at) * 1000),
                ) from exc
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
    openai_result = _responses_create_with_retry(
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
    parsed = GeneratePersonasResponse.model_validate_json(openai_result.response.output_text)
    parsed.used_openai = True
    parsed.fallback_reason = None
    return parsed


def analyze_ad_with_openai(
    campaign_name: str,
    advertisement_copy: str,
    channel: str,
    placement: str,
    campaign_context: str,
    request_id: str | None = None,
) -> AdAnalysisResponse:
    prompt = f"""
Analyze this banking advertisement for a synthetic audience lab. Return valid JSON only.

Campaign name: {campaign_name}
Advertisement copy or campaign brief: {advertisement_copy}
Channel: {channel}
Placement / trigger point: {placement}
Optional campaign context: {campaign_context}

Requirements:
- Do not invent real customer data.
- Do not claim the output is a real customer prediction.
- Infer the intended audience from the ad text, offer, channel, and action requested.
- Keep wording plain and useful for a product team.
- productType should name the banking product or "General banking campaign".
- offerAngle should describe the main value proposition.
- likelyIntent should be one of: Awareness, Consideration, Conversion, Upsell, Retention.
- audienceCues should contain 2-5 concise audience descriptors.
- behaviorSignals should contain 2-5 likely financial or channel behaviours.
- ambiguity should list unclear assumptions or missing targeting information.
- audienceHypothesis should be one clear sentence describing the likely synthetic audience.
- expectedCustomerAction should describe what the customer is expected to do next.
- used_openai must be true.
- fallback_reason must be null.
"""
    openai_result = _responses_create_with_retry(
        request_id=request_id,
        endpoint="analyze-ad",
        persona_count=None,
        image_uploaded=False,
        model=_model(),
        input=[{"role": "user", "content": [{"type": "input_text", "text": prompt}]}],
        text={
            "format": {
                "type": "json_schema",
                "name": "ad_analysis_response",
                "schema": _schema_for(AdAnalysisResponse),
                "strict": True,
            }
        },
    )
    try:
        parsed = AdAnalysisResponse.model_validate_json(openai_result.response.output_text)
    except Exception as exc:
        setattr(exc, "attempts", openai_result.attempts)
        setattr(exc, "openai_response_ids", openai_result.response_ids)
        setattr(exc, "openai_response_id", getattr(openai_result.response, "id", None))
        setattr(exc, "openai_duration_ms", openai_result.duration_ms)
        raise
    return parsed.model_copy(
        update={
            "used_openai": True,
            "fallback_reason": None,
            "openaiResponseId": getattr(openai_result.response, "id", None),
            "openaiAttempts": openai_result.attempts,
            "openaiAttemptResponseIds": openai_result.response_ids,
            "openaiDurationMs": openai_result.duration_ms,
        }
    )


def derive_ad_analysis_from_segments_with_openai(
    campaign_name: str,
    advertisement_copy: str,
    channel: str,
    placement: str,
    campaign_context: str,
    segments: list[dict],
    profile_count: int,
    segmentation_service_url: str,
    request_id: str | None = None,
) -> AdAnalysisResponse:
    prompt = f"""
Derive a segment-backed audience analysis for this banking advertisement.
Return valid JSON only.

Campaign name: {campaign_name}
Advertisement copy or campaign brief: {advertisement_copy}
Channel: {channel}
Placement / trigger point: {placement}
Optional campaign context: {campaign_context}

Segmentation service result summary:
{json.dumps(segments, indent=2)}

Requirements:
- Treat the segment summary as the primary evidence for expected customers and
  behavior signals.
- Use the ad text to identify the product, offer, intent, and expected action.
- Do not claim these are real customers or a real prediction.
- Keep wording plain and useful for a product team.
- productType should name the banking product or "General banking campaign".
- offerAngle should describe the main value proposition.
- likelyIntent should be one of: Awareness, Consideration, Conversion, Upsell, Retention.
- audienceCues should contain 2-5 segment-backed customer descriptors.
- behaviorSignals should contain 2-5 financial or channel behaviours implied by
  the segment fit and generated feature profiles.
- ambiguity should list unclear assumptions, missing targeting information, or
  mismatches between the ad and the segment fit.
- audienceHypothesis should be one clear sentence describing the likely expected
  customers, grounded in the segment distribution.
- expectedCustomerAction should describe what the ad asks the customer to do next.
- segments must exactly match the segment summary provided.
- primarySegment must be the highest-percentage segment name, or null if none.
- profileCount must be {profile_count}.
- segmentationServiceUrl must be "{segmentation_service_url}".
- used_openai must be true.
- fallback_reason must be null.
"""
    openai_result = _responses_create_with_retry(
        request_id=request_id,
        endpoint="derive-ad-analysis-from-segments",
        persona_count=profile_count,
        image_uploaded=False,
        model=_model(),
        input=[{"role": "user", "content": [{"type": "input_text", "text": prompt}]}],
        text={
            "format": {
                "type": "json_schema",
                "name": "ad_analysis_response",
                "schema": _schema_for(AdAnalysisResponse),
                "strict": True,
            }
        },
    )
    try:
        parsed = AdAnalysisResponse.model_validate_json(openai_result.response.output_text)
    except Exception as exc:
        setattr(exc, "attempts", openai_result.attempts)
        setattr(exc, "openai_response_ids", openai_result.response_ids)
        setattr(exc, "openai_response_id", getattr(openai_result.response, "id", None))
        setattr(exc, "openai_duration_ms", openai_result.duration_ms)
        raise
    return parsed.model_copy(
        update={
            "segments": [
                item if isinstance(item, dict) else item.model_dump()
                for item in segments
            ],
            "primarySegment": segments[0]["segment_name"] if segments else None,
            "profileCount": profile_count,
            "segmentationServiceUrl": segmentation_service_url,
            "used_openai": True,
            "fallback_reason": None,
            "openaiResponseId": getattr(openai_result.response, "id", None),
            "openaiAttempts": openai_result.attempts,
            "openaiAttemptResponseIds": openai_result.response_ids,
            "openaiDurationMs": openai_result.duration_ms,
        }
    )


def generate_synthetic_feature_profiles_with_openai(
    campaign_name: str,
    advertisement_copy: str,
    channel: str,
    placement: str,
    campaign_context: str,
    audience_hypothesis: str,
    audience_cues: list[str],
    behavior_signals: list[str],
    profile_count: int,
    request_id: str | None = None,
) -> tuple[SyntheticFeatureProfilesResponse, OpenAIResponseResult]:
    prompt = f"""
Generate exactly {profile_count} synthetic customer banking feature records for
downstream segmentation. Return valid JSON only.

This is for a synthetic audience lab. Do not claim these are real customers.
Generate plausible feature values from the ad analysis, not personal identity data.

Campaign name: {campaign_name}
Advertisement copy: {advertisement_copy}
Channel: {channel}
Placement / trigger point: {placement}
Campaign context: {campaign_context}
Audience hypothesis: {audience_hypothesis}
Audience cues: {json.dumps(audience_cues)}
Behavior signals: {json.dumps(behavior_signals)}

Each profile must include exactly these fields:
customer_id, avg_monthly_inflow_6m, salary_inflow_ratio, inflow_cv_6m,
avg_balance_6m, min_balance_6m, avg_monthly_spend_6m, monthly_txn_count_6m,
digital_txn_ratio, cash_withdrawal_ratio, discretionary_spend_ratio,
travel_spend_ratio, investment_contribution_ratio, credit_card_utilisation,
days_since_last_txn, monthly_app_logins_3m, products_held, overdraft_events_6m.

Feature guidance:
- customer_id should be SYN001, SYN002, and so on.
- Ratio fields must be between 0 and 1.
- Money and count fields must be non-negative.
- min_balance_6m must not exceed avg_balance_6m.
- avg_monthly_spend_6m should usually not exceed avg_monthly_inflow_6m by more
  than 30% unless the ad implies borrowing or cashflow stress.
- Vary the profiles. Do not produce identical records.
- Use the ad semantics flexibly. For example, a travel rewards card may imply
  higher travel_spend_ratio, digital_txn_ratio, and credit_card_utilisation, but
  should still include some variation.
- used_openai must be true.
- fallback_reason must be null.
"""
    openai_result = _responses_create_with_retry(
        request_id=request_id,
        endpoint="generate-feature-profiles",
        persona_count=profile_count,
        image_uploaded=False,
        model=_model(),
        input=[{"role": "user", "content": [{"type": "input_text", "text": prompt}]}],
        text={
            "format": {
                "type": "json_schema",
                "name": "synthetic_feature_profiles_response",
                "schema": _schema_for(SyntheticFeatureProfilesResponse),
                "strict": True,
            }
        },
    )
    try:
        parsed = SyntheticFeatureProfilesResponse.model_validate_json(
            openai_result.response.output_text
        )
    except Exception as exc:
        setattr(exc, "attempts", openai_result.attempts)
        setattr(exc, "openai_response_ids", openai_result.response_ids)
        setattr(exc, "openai_response_id", getattr(openai_result.response, "id", None))
        setattr(exc, "openai_duration_ms", openai_result.duration_ms)
        raise
    parsed.used_openai = True
    parsed.fallback_reason = None
    return parsed, openai_result


def advise_on_simulation_with_openai(
    request: AdvisorChatRequest,
    request_id: str | None = None,
) -> AdvisorChatResponse:
    context = request.model_dump(
        exclude={
            "simulationResult": {
                "rawOpenAIResult",
                "developmentDebug",
                "openaiResponseId",
                "openaiAttempts",
                "openaiAttemptResponseIds",
            }
        }
    )
    prompt = f"""
You are a banking pre-launch risk advisor for a synthetic customer lab.
Answer the user's latest question using only the provided campaign, personas,
simulation result, and chat history.

Rules:
- Do not provide legal, regulatory, or compliance approval.
- Do not claim synthetic personas represent real customers.
- If the user asks outside the provided context, say what information is missing.
- Be concrete and action-oriented. Prefer bullets when comparing risks or changes.
- Focus on clarity, trust, stress, fairness, accessibility, privacy, financial
  wellbeing, operational risk, and customer understanding.
- If asked to rewrite copy, provide the revised copy plus a short rationale.
- Keep the answer under 600 words.
- Set used_openai to true and fallback_reason to null.
- Return valid JSON only.

Simulation context JSON:
{json.dumps(context, indent=2)}
"""
    openai_result = _responses_create_with_retry(
        request_id=request_id,
        endpoint="simulation-advisor-chat",
        persona_count=len(request.personas),
        image_uploaded=request.campaignInput.screenshotUploaded,
        model=_model(),
        input=[{"role": "user", "content": [{"type": "input_text", "text": prompt}]}],
        text={
            "format": {
                "type": "json_schema",
                "name": "advisor_chat_response",
                "schema": _schema_for(AdvisorChatResponse),
                "strict": True,
            }
        },
    )
    try:
        parsed = AdvisorChatResponse.model_validate_json(
            openai_result.response.output_text
        )
    except Exception as exc:
        setattr(exc, "attempts", openai_result.attempts)
        setattr(exc, "openai_response_ids", openai_result.response_ids)
        setattr(exc, "openai_response_id", getattr(openai_result.response, "id", None))
        setattr(exc, "openai_duration_ms", openai_result.duration_ms)
        raise
    return parsed.model_copy(
        update={
            "used_openai": True,
            "fallback_reason": None,
            "openaiResponseId": getattr(openai_result.response, "id", None),
            "openaiAttempts": openai_result.attempts,
            "openaiAttemptResponseIds": openai_result.response_ids,
            "openaiDurationMs": openai_result.duration_ms,
        }
    )


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

    openai_result = _responses_create_with_retry(
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
    post_processing_started_at = time.perf_counter()
    try:
        parsed = SimulationResultResponse.model_validate_json(
            openai_result.response.output_text
        )
    except Exception as exc:
        setattr(exc, "attempts", openai_result.attempts)
        setattr(exc, "openai_response_ids", openai_result.response_ids)
        setattr(exc, "openai_response_id", getattr(openai_result.response, "id", None))
        setattr(exc, "openai_duration_ms", openai_result.duration_ms)
        raise
    parsed.used_openai = True
    parsed.fallback_reason = None
    parsed.openaiResponseId = getattr(openai_result.response, "id", None)
    parsed.openaiAttempts = openai_result.attempts
    parsed.openaiAttemptResponseIds = openai_result.response_ids
    parsed.openaiDurationMs = openai_result.duration_ms
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
                "openaiAttempts": openai_result.attempts,
                "openaiAttemptResponseIds": openai_result.response_ids,
                "openaiDurationMs": openai_result.duration_ms,
                "postProcessingDurationMs": int(
                    (time.perf_counter() - post_processing_started_at) * 1000
                ),
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
                "openaiAttempts": openai_result.attempts,
                "openaiAttemptResponseIds": openai_result.response_ids,
                "openaiDurationMs": openai_result.duration_ms,
                "postProcessingDurationMs": int(
                    (time.perf_counter() - post_processing_started_at) * 1000
                ),
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
