import json
import logging
import os
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError

from app.auth import AuthenticatedUser, require_authenticated_user
from app.models import (
    AdAnalysisRequest,
    AdAnalysisResponse,
    AdvisorChatRequest,
    AdvisorChatResponse,
    AudienceFitRequest,
    AudienceFitResponse,
    CustomerFeatureRecord,
    GeneratePersonasRequest,
    GeneratePersonasResponse,
    GeneratedPersona,
    LegacyPersona,
    SegmentFitSummary,
    DevelopmentDebug,
    SimulationResultResponse,
)
from app.openai_client import (
    analyze_ad_with_openai,
    advise_on_simulation_with_openai,
    generate_synthetic_feature_profiles_with_openai,
    generate_personas_with_openai,
    simulate_with_openai,
)
from app.persona_generation import build_mock_personas
from app.personas import PERSONAS
from app.scoring import build_mock_simulation


app = FastAPI(title="Synthetic Customer Lab API")
logger = logging.getLogger("synthetic_customer_lab")
logging.basicConfig(level=logging.INFO)


def _cors_origins_from_env() -> list[str]:
    raw = os.getenv("CORS_ORIGINS", "")
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        *_cors_origins_from_env(),
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/personas", response_model=list[LegacyPersona])
def get_personas(
    _user: AuthenticatedUser = Depends(require_authenticated_user),
) -> list[LegacyPersona]:
    return PERSONAS


@app.post("/api/analyze-ad", response_model=AdAnalysisResponse)
def analyze_ad(
    request: AdAnalysisRequest,
    _user: AuthenticatedUser = Depends(require_authenticated_user),
) -> AdAnalysisResponse:
    request_id = uuid4().hex
    endpoint_started_at = time.perf_counter()
    logger.info(
        "analyze_ad_request_received requestId=%s timestamp=%s campaignName=%r",
        request_id,
        _utc_timestamp(),
        request.campaignName,
    )

    openai_started_at: float | None = None
    try:
        openai_started_at = time.perf_counter()
        logger.info(
            "analyze_ad_openai_start requestId=%s timestamp=%s",
            request_id,
            _utc_timestamp(),
        )
        result = analyze_ad_with_openai(
            campaign_name=request.campaignName,
            advertisement_copy=request.advertisementCopy,
            channel=request.channel,
            placement=request.placement,
            campaign_context=request.campaignContext,
            request_id=request_id,
        )
        duration_ms = _duration_ms(endpoint_started_at)
        openai_duration_ms = result.openaiDurationMs or _duration_ms(openai_started_at)
        logger.info(
            "analyze_ad_response_returned requestId=%s timestamp=%s durationMs=%s "
            "openaiDurationMs=%s success=True used_openai=%s",
            request_id,
            _utc_timestamp(),
            duration_ms,
            openai_duration_ms,
            result.used_openai,
        )
        return result.model_copy(
            update={
                "requestId": request_id,
                "durationMs": duration_ms,
                "openaiDurationMs": openai_duration_ms,
            }
        )
    except Exception as exc:
        duration_ms = _duration_ms(endpoint_started_at)
        error = normalize_fallback_reason(exc)
        openai_attempts = getattr(exc, "attempts", None)
        openai_response_ids = getattr(exc, "openai_response_ids", None)
        openai_duration_ms = getattr(exc, "openai_duration_ms", None)
        openai_response_id = getattr(exc, "openai_response_id", None)
        if openai_started_at is not None:
            logger.info(
                "analyze_ad_openai_end requestId=%s timestamp=%s openaiDurationMs=%s "
                "success=False openaiAttempts=%s openaiResponseId=%r "
                "openaiAttemptResponseIds=%s error=%r",
                request_id,
                _utc_timestamp(),
                openai_duration_ms or _duration_ms(openai_started_at),
                openai_attempts,
                openai_response_id,
                openai_response_ids,
                error,
            )
        logger.exception(
            "analyze_ad_response_returned requestId=%s timestamp=%s durationMs=%s "
            "success=False error=%r",
            request_id,
            _utc_timestamp(),
            duration_ms,
            error,
        )
        raise HTTPException(
            status_code=_openai_error_status(error),
            detail={
                "requestId": request_id,
                "error": error,
                "durationMs": duration_ms,
                "openaiAttempts": openai_attempts,
                "openaiResponseId": openai_response_id,
                "openaiAttemptResponseIds": openai_response_ids,
                "openaiDurationMs": openai_duration_ms,
            },
        ) from exc


@app.post("/api/audience-fit", response_model=AudienceFitResponse)
def audience_fit(
    request: AudienceFitRequest,
    _user: AuthenticatedUser = Depends(require_authenticated_user),
) -> AudienceFitResponse:
    request_id = uuid4().hex
    endpoint_started_at = time.perf_counter()
    segmentation_url = _segmentation_service_url()
    logger.info(
        "audience_fit_request_received requestId=%s timestamp=%s campaignName=%r "
        "profileCount=%s segmentationUrl=%s",
        request_id,
        _utc_timestamp(),
        request.campaignName,
        request.profileCount,
        segmentation_url,
    )

    openai_started_at: float | None = None
    try:
        openai_started_at = time.perf_counter()
        profiles_result, openai_result = generate_synthetic_feature_profiles_with_openai(
            campaign_name=request.campaignName,
            advertisement_copy=request.advertisementCopy,
            channel=request.channel,
            placement=request.placement,
            campaign_context=request.campaignContext,
            audience_hypothesis=request.audienceHypothesis,
            audience_cues=request.audienceCues,
            behavior_signals=request.behaviorSignals,
            profile_count=request.profileCount,
            request_id=request_id,
        )
        profiles = [_normalize_feature_record(profile) for profile in profiles_result.profiles]
        segment_results = _segment_profiles(segmentation_url, profiles)
        segments = _aggregate_segment_results(segment_results)
        duration_ms = _duration_ms(endpoint_started_at)
        primary_segment = segments[0].segment_name if segments else None
        logger.info(
            "audience_fit_response_returned requestId=%s timestamp=%s durationMs=%s "
            "profileCount=%s primarySegment=%r success=True",
            request_id,
            _utc_timestamp(),
            duration_ms,
            len(profiles),
            primary_segment,
        )
        return AudienceFitResponse(
            segments=segments,
            profileCount=len(profiles),
            primarySegment=primary_segment,
            segmentationServiceUrl=segmentation_url,
            used_openai=True,
            fallback_reason=None,
            requestId=request_id,
            durationMs=duration_ms,
            openaiResponseId=getattr(openai_result.response, "id", None),
            openaiAttempts=openai_result.attempts,
            openaiAttemptResponseIds=openai_result.response_ids,
            openaiDurationMs=openai_result.duration_ms,
        )
    except Exception as exc:
        duration_ms = _duration_ms(endpoint_started_at)
        error = normalize_fallback_reason(exc)
        openai_attempts = getattr(exc, "attempts", None)
        openai_response_ids = getattr(exc, "openai_response_ids", None)
        openai_duration_ms = getattr(exc, "openai_duration_ms", None)
        openai_response_id = getattr(exc, "openai_response_id", None)
        if openai_started_at is not None:
            logger.info(
                "audience_fit_openai_or_segmentation_end requestId=%s timestamp=%s "
                "durationMs=%s success=False openaiAttempts=%s error=%r",
                request_id,
                _utc_timestamp(),
                openai_duration_ms or _duration_ms(openai_started_at),
                openai_attempts,
                error,
            )
        logger.exception(
            "audience_fit_response_returned requestId=%s timestamp=%s durationMs=%s "
            "success=False error=%r",
            request_id,
            _utc_timestamp(),
            duration_ms,
            error,
        )
        raise HTTPException(
            status_code=_openai_error_status(error),
            detail={
                "requestId": request_id,
                "error": error,
                "durationMs": duration_ms,
                "openaiAttempts": openai_attempts,
                "openaiResponseId": openai_response_id,
                "openaiAttemptResponseIds": openai_response_ids,
                "openaiDurationMs": openai_duration_ms,
            },
        ) from exc


@app.post("/api/chat", response_model=AdvisorChatResponse)
def advisor_chat(
    request: AdvisorChatRequest,
    _user: AuthenticatedUser = Depends(require_authenticated_user),
) -> AdvisorChatResponse:
    request_id = uuid4().hex
    endpoint_started_at = time.perf_counter()
    logger.info(
        "advisor_chat_request_received requestId=%s timestamp=%s messageCount=%s",
        request_id,
        _utc_timestamp(),
        len(request.messages),
    )
    try:
        result = advise_on_simulation_with_openai(request, request_id=request_id)
        duration_ms = _duration_ms(endpoint_started_at)
        logger.info(
            "advisor_chat_response_returned requestId=%s timestamp=%s durationMs=%s "
            "success=True used_openai=%s",
            request_id,
            _utc_timestamp(),
            duration_ms,
            result.used_openai,
        )
        return result.model_copy(update={"requestId": request_id, "durationMs": duration_ms})
    except Exception as exc:
        duration_ms = _duration_ms(endpoint_started_at)
        fallback_reason = normalize_fallback_reason(exc)
        logger.exception(
            "advisor_chat_response_returned requestId=%s timestamp=%s durationMs=%s "
            "success=False error=%r",
            request_id,
            _utc_timestamp(),
            duration_ms,
            fallback_reason,
        )
        return _fallback_advisor_response(
            request=request,
            request_id=request_id,
            duration_ms=duration_ms,
            fallback_reason=fallback_reason,
        )


@app.post("/api/generate-personas", response_model=GeneratePersonasResponse)
def generate_personas(
    request: GeneratePersonasRequest,
    _user: AuthenticatedUser = Depends(require_authenticated_user),
) -> GeneratePersonasResponse:
    request_id = uuid4().hex
    endpoint_started_at = time.perf_counter()
    request_received_at = _utc_timestamp()
    logger.info(
        "generate_personas_request_received requestId=%s timestamp=%s "
        "featureName=%r personaCount=%s",
        request_id,
        request_received_at,
        request.featureName,
        request.personaCount,
    )

    openai_started_at: float | None = None
    try:
        openai_started_at = time.perf_counter()
        logger.info(
            "generate_personas_openai_start requestId=%s timestamp=%s",
            request_id,
            _utc_timestamp(),
        )
        result = generate_personas_with_openai(
            feature_name=request.featureName,
            banking_message=request.bankingMessage,
            target_customers=request.targetCustomers,
            channel=request.channel,
            send_timing=request.sendTiming,
            persona_count=request.personaCount,
            request_id=request_id,
        )
        openai_duration_ms = _duration_ms(openai_started_at)
        duration_ms = _duration_ms(endpoint_started_at)
        logger.info(
            "generate_personas_openai_end requestId=%s timestamp=%s "
            "openaiDurationMs=%s success=True personaNames=%s",
            request_id,
            _utc_timestamp(),
            openai_duration_ms,
            [persona.name for persona in result.personas],
        )
        logger.info(
            "generate_personas_response_returned requestId=%s timestamp=%s "
            "durationMs=%s success=True used_openai=%s fallback_reason=%r",
            request_id,
            _utc_timestamp(),
            duration_ms,
            result.used_openai,
            result.fallback_reason,
        )
        return result.model_copy(
            update={"requestId": request_id, "durationMs": duration_ms}
        )
    except Exception as exc:
        duration_ms = _duration_ms(endpoint_started_at)
        error = normalize_fallback_reason(exc)
        if openai_started_at is not None:
            logger.info(
                "generate_personas_openai_end requestId=%s timestamp=%s "
                "openaiDurationMs=%s success=False error=%r",
                request_id,
                _utc_timestamp(),
                _duration_ms(openai_started_at),
                error,
            )
        logger.exception(
            "generate_personas_response_returned requestId=%s timestamp=%s "
            "durationMs=%s success=False error=%r",
            request_id,
            _utc_timestamp(),
            duration_ms,
            error,
        )
        raise HTTPException(
            status_code=_openai_error_status(error),
            detail={
                "requestId": request_id,
                "error": error,
                "durationMs": duration_ms,
            },
        ) from exc


@app.post("/api/run-simulation", response_model=SimulationResultResponse)
async def run_simulation(
    featureName: str = Form(...),
    bankingMessage: str = Form(...),
    targetCustomers: str = Form(...),
    channel: str = Form(...),
    sendTiming: str = Form(...),
    personas: str = Form(...),
    screenshot: UploadFile | None = File(default=None),
    _user: AuthenticatedUser = Depends(require_authenticated_user),
) -> SimulationResultResponse:
    request_id = uuid4().hex
    endpoint_started_at = time.perf_counter()
    request_received_at = _utc_timestamp()
    generated_personas = _parse_personas(personas, request_id)
    image_bytes = None
    image_content_type = None
    if screenshot is not None:
        image_bytes = await screenshot.read()
        image_content_type = screenshot.content_type
    image_uploaded = image_bytes is not None
    persona_names = [persona.name for persona in generated_personas]

    logger.info(
        "simulation_request_received requestId=%s timestamp=%s "
        "featureName=%r personaCount=%s personaNames=%s imageUploaded=%s",
        request_id,
        request_received_at,
        featureName,
        len(persona_names),
        persona_names,
        image_uploaded,
    )
    _log_simulation_event(
        request_id=request_id,
        feature_name=featureName,
        persona_names=persona_names,
        image_uploaded=image_uploaded,
        openai_called=False,
        openai_succeeded=False,
        used_openai=False,
        fallback_reason=None,
    )

    openai_started_at: float | None = None
    try:
        openai_started_at = time.perf_counter()
        logger.info(
            "simulation_openai_start requestId=%s timestamp=%s",
            request_id,
            _utc_timestamp(),
        )
        result = simulate_with_openai(
            personas=generated_personas,
            feature_name=featureName,
            banking_message=bankingMessage,
            target_customers=targetCustomers,
            channel=channel,
            send_timing=sendTiming,
            image_bytes=image_bytes,
            image_content_type=image_content_type,
            request_id=request_id,
        )
        duration_ms = _duration_ms(endpoint_started_at)
        openai_duration_ms = result.openaiDurationMs or _duration_ms(openai_started_at)
        logger.info(
            "simulation_openai_end requestId=%s timestamp=%s openaiDurationMs=%s "
            "success=True openaiAttempts=%s openaiResponseId=%r "
            "openaiAttemptResponseIds=%s postProcessingDurationMs=%s",
            request_id,
            _utc_timestamp(),
            openai_duration_ms,
            result.openaiAttempts,
            result.openaiResponseId,
            result.openaiAttemptResponseIds,
            result.postProcessingDurationMs,
        )
        result = result.model_copy(
            update={
                "requestId": request_id,
                "durationMs": duration_ms,
                "openaiDurationMs": openai_duration_ms,
            }
        )
        _log_simulation_event(
            request_id=request_id,
            feature_name=featureName,
            persona_names=persona_names,
            image_uploaded=image_uploaded,
            openai_called=True,
            openai_succeeded=True,
            used_openai=result.used_openai,
            fallback_reason=result.fallback_reason,
            openai_attempts=result.openaiAttempts,
            openai_response_id=result.openaiResponseId,
            post_processing_warning=result.postProcessingWarning,
        )
        logger.info(
            "simulation_response_returned requestId=%s timestamp=%s durationMs=%s "
            "success=True used_openai=%s fallback_reason=%r",
            request_id,
            _utc_timestamp(),
            duration_ms,
            result.used_openai,
            result.fallback_reason,
        )
        return _with_development_debug(
            result=result,
            request_id=request_id,
            image_uploaded=image_uploaded,
            persona_names=persona_names,
        )
    except Exception as exc:
        duration_ms = _duration_ms(endpoint_started_at)
        fallback_reason = normalize_fallback_reason(exc)
        openai_attempts = getattr(exc, "attempts", None)
        openai_response_ids = getattr(exc, "openai_response_ids", None)
        openai_duration_ms = getattr(exc, "openai_duration_ms", None)
        openai_response_id = getattr(exc, "openai_response_id", None)
        if openai_started_at is not None:
            logger.info(
                "simulation_openai_end requestId=%s timestamp=%s openaiDurationMs=%s "
                "success=False openaiAttempts=%s openaiResponseId=%r "
                "openaiAttemptResponseIds=%s error=%r",
                request_id,
                _utc_timestamp(),
                openai_duration_ms or _duration_ms(openai_started_at),
                openai_attempts,
                openai_response_id,
                openai_response_ids,
                fallback_reason,
            )
        _log_simulation_event(
            request_id=request_id,
            feature_name=featureName,
            persona_names=persona_names,
            image_uploaded=image_uploaded,
            openai_called=True,
            openai_succeeded=False,
            used_openai=False,
            fallback_reason=fallback_reason,
            openai_attempts=openai_attempts,
            openai_response_id=openai_response_id,
            post_processing_warning=None,
        )
        logger.exception(
            "simulation_response_returned requestId=%s timestamp=%s durationMs=%s "
            "success=False error=%r openaiAttempts=%s openaiResponseId=%r "
            "openaiAttemptResponseIds=%s",
            request_id,
            _utc_timestamp(),
            duration_ms,
            fallback_reason,
            openai_attempts,
            openai_response_id,
            openai_response_ids,
        )
        raise HTTPException(
            status_code=_openai_error_status(fallback_reason),
            detail={
                "requestId": request_id,
                "error": fallback_reason,
                "durationMs": duration_ms,
                "openaiAttempts": openai_attempts,
                "openaiResponseId": openai_response_id,
                "openaiAttemptResponseIds": openai_response_ids,
                "openaiDurationMs": openai_duration_ms,
            },
        ) from exc


@app.post("/api/simulate", response_model=SimulationResultResponse)
async def simulate_compatibility(
    feature_name: str = Form(...),
    message: str = Form(...),
    target_customers: str = Form(...),
    channel: str = Form(...),
    send_timing: str = Form(...),
    screenshot: UploadFile | None = File(default=None),
    _user: AuthenticatedUser = Depends(require_authenticated_user),
) -> SimulationResultResponse:
    request_id = uuid4().hex
    personas = build_mock_personas(
        feature_name=feature_name,
        banking_message=message,
        target_customers=target_customers,
        channel=channel,
        send_timing=send_timing,
        persona_count=6,
    )
    image_bytes = None
    image_content_type = None
    if screenshot is not None:
        image_bytes = await screenshot.read()
        image_content_type = screenshot.content_type
    image_uploaded = image_bytes is not None
    persona_names = [persona.name for persona in personas]

    try:
        result = simulate_with_openai(
            personas=personas,
            feature_name=feature_name,
            banking_message=message,
            target_customers=target_customers,
            channel=channel,
            send_timing=send_timing,
            image_bytes=image_bytes,
            image_content_type=image_content_type,
            request_id=request_id,
        )
        _log_simulation_event(
            request_id=request_id,
            feature_name=feature_name,
            persona_names=persona_names,
            image_uploaded=image_uploaded,
            openai_called=True,
            openai_succeeded=True,
            used_openai=result.used_openai,
            fallback_reason=result.fallback_reason,
            openai_attempts=result.openaiAttempts,
            openai_response_id=result.openaiResponseId,
            post_processing_warning=result.postProcessingWarning,
        )
        return _with_development_debug(
            result=result,
            request_id=request_id,
            image_uploaded=image_uploaded,
            persona_names=persona_names,
        )
    except Exception as exc:
        fallback_reason = normalize_fallback_reason(exc)
        openai_attempts = getattr(exc, "attempts", None)
        result = build_mock_simulation(
            personas=personas,
            feature_name=feature_name,
            message=message,
            target_customers=target_customers,
            channel=channel,
            send_timing=send_timing,
            image_uploaded=image_uploaded,
            fallback_reason=fallback_reason,
        )
        result = result.model_copy(update={"openaiAttempts": openai_attempts})
        _log_simulation_event(
            request_id=request_id,
            feature_name=feature_name,
            persona_names=persona_names,
            image_uploaded=image_uploaded,
            openai_called=True,
            openai_succeeded=False,
            used_openai=result.used_openai,
            fallback_reason=fallback_reason,
            openai_attempts=result.openaiAttempts,
            openai_response_id=result.openaiResponseId,
            post_processing_warning=result.postProcessingWarning,
        )
        return _with_development_debug(
            result=result,
            request_id=request_id,
            image_uploaded=image_uploaded,
            persona_names=persona_names,
        )


def _parse_personas(personas_json: str, request_id: str) -> list[GeneratedPersona]:
    try:
        raw = json.loads(personas_json)
        return [GeneratedPersona.model_validate(item) for item in raw]
    except (json.JSONDecodeError, TypeError, ValidationError) as exc:
        logger.exception(
            "simulation_request_failed requestId=%s validation_error=%s",
            request_id,
            exc,
        )
        raise HTTPException(
            status_code=400,
            detail={"requestId": request_id, "error": "Invalid personas payload"},
        ) from exc


def _with_development_debug(
    result: SimulationResultResponse,
    request_id: str,
    image_uploaded: bool,
    persona_names: list[str],
) -> SimulationResultResponse:
    raw_openai_result = result.rawOpenAIResult if is_development_mode() else None
    debug = DevelopmentDebug(
        requestId=request_id,
        used_openai=result.used_openai,
        fallback_reason=result.fallback_reason,
        imageUploaded=image_uploaded,
        personaCount=len(persona_names),
        personaNames=persona_names,
        hasRawOpenAIResult=result.rawOpenAIResult is not None,
        openaiResponseId=result.openaiResponseId,
        openaiAttempts=result.openaiAttempts,
        openaiAttemptResponseIds=result.openaiAttemptResponseIds,
        durationMs=result.durationMs,
        openaiDurationMs=result.openaiDurationMs,
        postProcessingDurationMs=result.postProcessingDurationMs,
        postProcessingWarning=result.postProcessingWarning,
        rawOpenAIResult=raw_openai_result,
    )
    return result.model_copy(update={"developmentDebug": debug})


def is_development_mode() -> bool:
    return os.getenv("APP_ENV", "development").lower() != "production"


def _segmentation_service_url() -> str:
    return os.getenv("SEGMENTATION_SERVICE_URL", "http://127.0.0.1:8000").rstrip("/")


def _normalize_feature_record(record: CustomerFeatureRecord) -> CustomerFeatureRecord:
    data = record.model_dump()
    for key in [
        "salary_inflow_ratio",
        "digital_txn_ratio",
        "cash_withdrawal_ratio",
        "discretionary_spend_ratio",
        "travel_spend_ratio",
        "investment_contribution_ratio",
        "credit_card_utilisation",
    ]:
        data[key] = min(1.0, max(0.0, float(data[key])))
    for key in [
        "avg_monthly_inflow_6m",
        "inflow_cv_6m",
        "avg_balance_6m",
        "min_balance_6m",
        "avg_monthly_spend_6m",
        "monthly_txn_count_6m",
        "days_since_last_txn",
        "monthly_app_logins_3m",
        "products_held",
        "overdraft_events_6m",
    ]:
        data[key] = max(0.0, float(data[key]))
    data["min_balance_6m"] = min(data["min_balance_6m"], data["avg_balance_6m"])
    return CustomerFeatureRecord.model_validate(data)


def _segment_profiles(
    segmentation_url: str,
    profiles: list[CustomerFeatureRecord],
) -> list[dict]:
    payload = json.dumps(
        {"customers": [profile.model_dump() for profile in profiles]}
    ).encode("utf-8")
    request = urllib.request.Request(
        f"{segmentation_url}/v1/segment",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            raw = json.loads(response.read().decode("utf-8"))
    except urllib.error.URLError as exc:
        raise RuntimeError(f"segmentation_service_error: {exc}") from exc
    results = raw.get("results")
    if not isinstance(results, list):
        raise RuntimeError("segmentation_service_error: missing results")
    return results


def _aggregate_segment_results(results: list[dict]) -> list[SegmentFitSummary]:
    total = len(results)
    grouped: dict[str, dict] = {}
    for result in results:
        name = str(result["segment_name"])
        group = grouped.setdefault(
            name,
            {
                "segment_id": int(result["segment_id"]),
                "segment_name": name,
                "count": 0,
                "confidence_sum": 0.0,
            },
        )
        group["count"] += 1
        group["confidence_sum"] += float(result.get("assignment_confidence", 0))
    summaries = [
        SegmentFitSummary(
            segment_id=group["segment_id"],
            segment_name=group["segment_name"],
            count=group["count"],
            percentage=round((group["count"] / total) * 100, 1) if total else 0,
            average_confidence=round(group["confidence_sum"] / group["count"], 4),
        )
        for group in grouped.values()
    ]
    return sorted(summaries, key=lambda item: item.percentage, reverse=True)


def _utc_timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def _duration_ms(started_at: float) -> int:
    return int((time.perf_counter() - started_at) * 1000)


def _openai_error_status(error: str) -> int:
    lower = error.lower()
    if "timeout" in lower:
        return 504
    if "validation" in lower or "json_parse" in lower:
        return 502
    return 502


def _fallback_advisor_response(
    request: AdvisorChatRequest,
    request_id: str,
    duration_ms: int,
    fallback_reason: str,
) -> AdvisorChatResponse:
    latest_question = request.messages[-1].content
    result = request.simulationResult
    risks = "; ".join(result.topRisks[:4]) or "no top risks were provided"
    recommendations = "; ".join(result.topRecommendations[:3])
    answer = (
        "I could not reach the AI advisor, so here is a local summary from the "
        f"simulation result. Your question was: {latest_question}\n\n"
        f"Launch decision: {result.overallDecision}.\n"
        f"Main risks: {risks}.\n"
        f"Most affected personas: {', '.join(result.topAffectedPersonas) or 'not specified'}.\n"
        f"Recommended next steps: {recommendations}.\n\n"
        "Retry the advisor for a more tailored answer."
    )
    return AdvisorChatResponse(
        answer=answer,
        suggestedPrompts=[
            "What should we fix first?",
            "Rewrite the message to reduce risk.",
            "Which persona is most affected?",
        ],
        used_openai=False,
        fallback_reason=fallback_reason,
        requestId=request_id,
        durationMs=duration_ms,
    )


def normalize_fallback_reason(exc: Exception) -> str:
    message = str(exc)
    lower = message.lower()
    if "520" in message:
        return f"openai_520: {message}"
    if "timed out" in lower or "timeout" in lower:
        return f"openai_timeout: {message}"
    if "validation" in lower or "pydantic" in lower:
        return f"schema_validation_error: {message}"
    if "json" in lower:
        return f"json_parse_error: {message}"
    return message


def _log_simulation_event(
    request_id: str,
    feature_name: str,
    persona_names: list[str],
    image_uploaded: bool,
    openai_called: bool,
    openai_succeeded: bool,
    used_openai: bool,
    fallback_reason: str | None,
    openai_attempts: int | None = None,
    openai_response_id: str | None = None,
    post_processing_warning: str | None = None,
) -> None:
    logger.info(
        "simulation_request requestId=%s featureName=%r personaCount=%s "
        "personaNames=%s imageUploaded=%s openaiCalled=%s openaiSucceeded=%s "
        "used_openai=%s fallback_reason=%r openaiAttempts=%s openaiResponseId=%r "
        "postProcessingWarning=%r",
        request_id,
        feature_name,
        len(persona_names),
        persona_names,
        image_uploaded,
        openai_called,
        openai_succeeded,
        used_openai,
        fallback_reason,
        openai_attempts,
        openai_response_id,
        post_processing_warning,
    )
