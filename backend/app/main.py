import json
import logging
import os
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from threading import RLock
from uuid import uuid4

from fastapi import BackgroundTasks, Depends, FastAPI, File, Form, HTTPException, UploadFile
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
    BatchLaunchLoss,
    SimulationBatchProgress,
    SegmentFitSummary,
    DevelopmentDebug,
    SimulationJobCreateResponse,
    SimulationJobStatusResponse,
    SimulationResultResponse,
)
from app.openai_client import (
    advise_on_simulation_with_openai,
    derive_ad_analysis_from_segments_with_openai,
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
SIMULATION_JOBS: dict[str, dict] = {}
SIMULATION_JOBS_LOCK = RLock()
SIMULATION_JOB_TTL_SECONDS = 60 * 60
SIMULATION_JOB_LIMIT = 100
AD_ANALYSIS_PROFILE_COUNT = 6
DEFAULT_PERSONA_GENERATION_BATCH_SIZE = 10
DEFAULT_MAX_PERSONA_COUNT = 50
DEFAULT_SIMULATION_BATCH_SIZE = 10


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
    segmentation_url = _segmentation_service_url()
    logger.info(
        "analyze_ad_request_received requestId=%s timestamp=%s campaignName=%r "
        "segmentationUrl=%s",
        request_id,
        _utc_timestamp(),
        request.campaignName,
        segmentation_url,
    )

    openai_started_at: float | None = None
    try:
        openai_started_at = time.perf_counter()
        logger.info(
            "analyze_ad_feature_profiles_start requestId=%s timestamp=%s",
            request_id,
            _utc_timestamp(),
        )
        profiles_result, profiles_openai_result = generate_synthetic_feature_profiles_with_openai(
            campaign_name=request.campaignName,
            advertisement_copy=request.advertisementCopy,
            channel=request.channel,
            placement=request.placement,
            campaign_context=request.campaignContext,
            audience_hypothesis=(
                "No audience hypothesis yet. Generate plausible bank-owned "
                "feature records from the ad input so the segmentation service "
                "can identify expected customer segments first."
            ),
            audience_cues=[],
            behavior_signals=[],
            profile_count=AD_ANALYSIS_PROFILE_COUNT,
            request_id=request_id,
        )
        profiles = [_normalize_feature_record(profile) for profile in profiles_result.profiles]
        segment_results = _segment_profiles(segmentation_url, profiles)
        segments = _aggregate_segment_results(segment_results)
        segment_dicts = [segment.model_dump() for segment in segments]
        logger.info(
            "analyze_ad_segmentation_complete requestId=%s timestamp=%s "
            "profileCount=%s primarySegment=%r",
            request_id,
            _utc_timestamp(),
            len(profiles),
            segments[0].segment_name if segments else None,
        )
        result = derive_ad_analysis_from_segments_with_openai(
            campaign_name=request.campaignName,
            advertisement_copy=request.advertisementCopy,
            channel=request.channel,
            placement=request.placement,
            campaign_context=request.campaignContext,
            segments=segment_dicts,
            profile_count=len(profiles),
            segmentation_service_url=segmentation_url,
            request_id=request_id,
        )
        duration_ms = _duration_ms(endpoint_started_at)
        openai_duration_ms = (
            (profiles_openai_result.duration_ms or 0)
            + (result.openaiDurationMs or 0)
        )
        openai_attempts = profiles_openai_result.attempts + (result.openaiAttempts or 0)
        openai_response_ids = [
            *profiles_openai_result.response_ids,
            *(result.openaiAttemptResponseIds or []),
        ]
        logger.info(
            "analyze_ad_response_returned requestId=%s timestamp=%s durationMs=%s "
            "openaiDurationMs=%s success=True used_openai=%s primarySegment=%r",
            request_id,
            _utc_timestamp(),
            duration_ms,
            openai_duration_ms,
            result.used_openai,
            result.primarySegment,
        )
        return result.model_copy(
            update={
                "requestId": request_id,
                "durationMs": duration_ms,
                "openaiDurationMs": openai_duration_ms,
                "openaiAttempts": openai_attempts,
                "openaiAttemptResponseIds": openai_response_ids,
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
        result = _generate_personas_with_optional_batches(
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


def _generate_personas_with_optional_batches(
    feature_name: str,
    banking_message: str,
    target_customers: str,
    channel: str,
    send_timing: str,
    persona_count: int,
    request_id: str,
) -> GeneratePersonasResponse:
    max_persona_count = _int_env("MAX_PERSONA_COUNT", DEFAULT_MAX_PERSONA_COUNT)
    if persona_count > max_persona_count:
        raise ValueError(
            f"personaCount must be <= {max_persona_count} in this environment"
        )

    batch_size = _int_env(
        "PERSONA_GENERATION_BATCH_SIZE",
        DEFAULT_PERSONA_GENERATION_BATCH_SIZE,
    )
    if persona_count <= batch_size:
        return generate_personas_with_openai(
            feature_name=feature_name,
            banking_message=banking_message,
            target_customers=target_customers,
            channel=channel,
            send_timing=send_timing,
            persona_count=persona_count,
            request_id=request_id,
        )

    personas: list[GeneratedPersona] = []
    batch_count = (persona_count + batch_size - 1) // batch_size
    fallback_reasons: list[str] = []
    for batch_index in range(batch_count):
        remaining = persona_count - len(personas)
        current_batch_size = min(batch_size, remaining)
        batch_number = batch_index + 1
        logger.info(
            "generate_personas_batch_start requestId=%s timestamp=%s "
            "batch=%s totalBatches=%s batchSize=%s",
            request_id,
            _utc_timestamp(),
            batch_number,
            batch_count,
            current_batch_size,
        )
        batch_result = generate_personas_with_openai(
            feature_name=feature_name,
            banking_message=(
                f"{banking_message}\n\nBatch instruction: generate personas for "
                f"batch {batch_number} of {batch_count}. Make these personas "
                "distinct from earlier batches by varying life context, digital "
                "confidence, privacy sensitivity, language/accessibility needs, "
                "and financial stress."
            ),
            target_customers=target_customers,
            channel=channel,
            send_timing=send_timing,
            persona_count=current_batch_size,
            request_id=f"{request_id}_batch_{batch_number}",
        )
        personas.extend(batch_result.personas)
        if batch_result.fallback_reason:
            fallback_reasons.append(
                f"batch_{batch_number}: {batch_result.fallback_reason}"
            )
        logger.info(
            "generate_personas_batch_end requestId=%s timestamp=%s "
            "batch=%s totalBatches=%s generatedTotal=%s",
            request_id,
            _utc_timestamp(),
            batch_number,
            batch_count,
            len(personas),
        )

    normalized = [
        persona.model_copy(update={"id": f"persona_{index + 1}"})
        for index, persona in enumerate(personas[:persona_count])
    ]
    return GeneratePersonasResponse(
        personas=normalized,
        used_openai=True,
        fallback_reason="; ".join(fallback_reasons) if fallback_reasons else None,
    )


@app.post("/api/run-simulation-jobs", response_model=SimulationJobCreateResponse)
async def create_simulation_job(
    background_tasks: BackgroundTasks,
    featureName: str = Form(...),
    bankingMessage: str = Form(...),
    targetCustomers: str = Form(...),
    channel: str = Form(...),
    sendTiming: str = Form(...),
    personas: str = Form(...),
    screenshot: UploadFile | None = File(default=None),
    user: AuthenticatedUser = Depends(require_authenticated_user),
) -> SimulationJobCreateResponse:
    request_id = uuid4().hex
    job_id = f"sim_{uuid4().hex}"
    endpoint_started_at = time.perf_counter()
    generated_personas = _parse_personas(personas, request_id)
    image_bytes = None
    image_content_type = None
    if screenshot is not None:
        image_bytes = await screenshot.read()
        image_content_type = screenshot.content_type
    persona_names = [persona.name for persona in generated_personas]
    now = _utc_timestamp()
    now_epoch = time.time()
    batch_progress = _initial_simulation_batch_progress(generated_personas)

    with SIMULATION_JOBS_LOCK:
        _cleanup_simulation_jobs_locked(now_epoch)
        SIMULATION_JOBS[job_id] = {
            "jobId": job_id,
            "requestId": request_id,
            "userId": user.id,
            "status": "queued",
            "createdAt": now,
            "updatedAt": now,
            "createdAtEpoch": now_epoch,
            "updatedAtEpoch": now_epoch,
            "error": None,
            "result": None,
            "currentBatch": None,
            "totalBatches": len(batch_progress),
            "completedBatches": 0,
            "batchProgress": batch_progress,
        }

    logger.info(
        "simulation_job_created jobId=%s requestId=%s timestamp=%s "
        "featureName=%r personaCount=%s personaNames=%s imageUploaded=%s",
        job_id,
        request_id,
        now,
        featureName,
        len(persona_names),
        persona_names,
        image_bytes is not None,
    )
    background_tasks.add_task(
        _run_simulation_job,
        job_id,
        request_id,
        endpoint_started_at,
        featureName,
        bankingMessage,
        targetCustomers,
        channel,
        sendTiming,
        generated_personas,
        image_bytes,
        image_content_type,
    )
    return SimulationJobCreateResponse(
        jobId=job_id,
        status="queued",
        requestId=request_id,
    )


@app.get(
    "/api/run-simulation-jobs/{job_id}",
    response_model=SimulationJobStatusResponse,
)
def get_simulation_job(
    job_id: str,
    user: AuthenticatedUser = Depends(require_authenticated_user),
) -> SimulationJobStatusResponse:
    with SIMULATION_JOBS_LOCK:
        _cleanup_simulation_jobs_locked(time.time())
        job = SIMULATION_JOBS.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="Simulation job not found")
        if job["userId"] != user.id:
            raise HTTPException(status_code=404, detail="Simulation job not found")
        return _simulation_job_response(job)


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


def _run_simulation_job(
    job_id: str,
    request_id: str,
    endpoint_started_at: float,
    feature_name: str,
    banking_message: str,
    target_customers: str,
    channel: str,
    send_timing: str,
    generated_personas: list[GeneratedPersona],
    image_bytes: bytes | None,
    image_content_type: str | None,
) -> None:
    image_uploaded = image_bytes is not None
    persona_names = [persona.name for persona in generated_personas]
    _update_simulation_job(
        job_id,
        status="running",
        error=None,
        result=None,
    )
    _log_simulation_event(
        request_id=request_id,
        feature_name=feature_name,
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
            "simulation_job_openai_start jobId=%s requestId=%s timestamp=%s",
            job_id,
            request_id,
            _utc_timestamp(),
        )
        result = _simulate_with_optional_batches(
            job_id=job_id,
            personas=generated_personas,
            feature_name=feature_name,
            banking_message=banking_message,
            target_customers=target_customers,
            channel=channel,
            send_timing=send_timing,
            image_bytes=image_bytes,
            image_content_type=image_content_type,
            request_id=request_id,
        )
        duration_ms = _duration_ms(endpoint_started_at)
        openai_duration_ms = result.openaiDurationMs or _duration_ms(openai_started_at)
        result = result.model_copy(
            update={
                "requestId": request_id,
                "durationMs": duration_ms,
                "openaiDurationMs": openai_duration_ms,
            }
        )
        result = _with_development_debug(
            result=result,
            request_id=request_id,
            image_uploaded=image_uploaded,
            persona_names=persona_names,
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
        _update_simulation_job(
            job_id,
            status="completed",
            error=None,
            result=result,
        )
        logger.info(
            "simulation_job_completed jobId=%s requestId=%s timestamp=%s durationMs=%s",
            job_id,
            request_id,
            _utc_timestamp(),
            duration_ms,
        )
    except Exception as exc:
        duration_ms = _duration_ms(endpoint_started_at)
        fallback_reason = normalize_fallback_reason(exc)
        openai_attempts = getattr(exc, "attempts", None)
        openai_response_id = getattr(exc, "openai_response_id", None)
        openai_response_ids = getattr(exc, "openai_response_ids", None)
        openai_duration_ms = getattr(exc, "openai_duration_ms", None)
        if openai_started_at is not None:
            logger.info(
                "simulation_job_openai_end jobId=%s requestId=%s timestamp=%s "
                "openaiDurationMs=%s success=False openaiAttempts=%s "
                "openaiResponseId=%r openaiAttemptResponseIds=%s error=%r",
                job_id,
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
            feature_name=feature_name,
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
        _update_simulation_job(
            job_id,
            status="failed",
            error=fallback_reason,
            result=None,
        )
        logger.exception(
            "simulation_job_failed jobId=%s requestId=%s timestamp=%s "
            "durationMs=%s error=%r",
            job_id,
            request_id,
            _utc_timestamp(),
            duration_ms,
            fallback_reason,
        )


def _simulate_with_optional_batches(
    job_id: str | None,
    personas: list[GeneratedPersona],
    feature_name: str,
    banking_message: str,
    target_customers: str,
    channel: str,
    send_timing: str,
    image_bytes: bytes | None,
    image_content_type: str | None,
    request_id: str,
) -> SimulationResultResponse:
    batch_size = _int_env("SIMULATION_BATCH_SIZE", DEFAULT_SIMULATION_BATCH_SIZE)
    if len(personas) <= batch_size:
        if job_id is not None:
            _update_simulation_batch_progress(
                job_id=job_id,
                batch_index=1,
                status="running",
            )
        try:
            result = _with_launch_loss(
                simulate_with_openai(
                    personas=personas,
                    feature_name=feature_name,
                    banking_message=banking_message,
                    target_customers=target_customers,
                    channel=channel,
                    send_timing=send_timing,
                    image_bytes=image_bytes,
                    image_content_type=image_content_type,
                    request_id=request_id,
                )
            )
        except Exception as exc:
            if job_id is not None:
                _update_simulation_batch_progress(
                    job_id=job_id,
                    batch_index=1,
                    status="failed",
                    error=normalize_fallback_reason(exc),
                )
            raise
        if job_id is not None:
            _update_simulation_batch_progress(
                job_id=job_id,
                batch_index=1,
                status="completed",
                launch_loss=result.launchLoss,
                overall_decision=result.overallDecision,
            )
        return result

    batch_results: list[SimulationResultResponse] = []
    batch_losses: list[BatchLaunchLoss] = []
    total_batches = (len(personas) + batch_size - 1) // batch_size
    for batch_index, start in enumerate(range(0, len(personas), batch_size), start=1):
        batch_personas = personas[start : start + batch_size]
        if job_id is not None:
            _update_simulation_batch_progress(
                job_id=job_id,
                batch_index=batch_index,
                status="running",
            )
        logger.info(
            "simulation_batch_start requestId=%s timestamp=%s batch=%s "
            "totalBatches=%s personaStart=%s personaEnd=%s",
            request_id,
            _utc_timestamp(),
            batch_index,
            total_batches,
            start + 1,
            start + len(batch_personas),
        )
        try:
            batch_result = _with_launch_loss(
                simulate_with_openai(
                    personas=batch_personas,
                    feature_name=feature_name,
                    banking_message=(
                        f"{banking_message}\n\nBatch simulation instruction: this is "
                        f"batch {batch_index} of {total_batches}. Evaluate only the "
                        "personas supplied in this batch. The backend will aggregate "
                        "batch-level risk results after all batches complete."
                    ),
                    target_customers=target_customers,
                    channel=channel,
                    send_timing=send_timing,
                    image_bytes=image_bytes,
                    image_content_type=image_content_type,
                    request_id=f"{request_id}_sim_batch_{batch_index}",
                )
            )
        except Exception as exc:
            if job_id is not None:
                _update_simulation_batch_progress(
                    job_id=job_id,
                    batch_index=batch_index,
                    status="failed",
                    error=normalize_fallback_reason(exc),
                )
            raise
        batch_results.append(batch_result)
        batch_losses.append(
            BatchLaunchLoss(
                batchIndex=batch_index,
                personaStart=start + 1,
                personaEnd=start + len(batch_personas),
                personaCount=len(batch_personas),
                launchLoss=batch_result.launchLoss or 0,
                overallDecision=batch_result.overallDecision,
            )
        )
        if job_id is not None:
            _update_simulation_batch_progress(
                job_id=job_id,
                batch_index=batch_index,
                status="completed",
                launch_loss=batch_result.launchLoss,
                overall_decision=batch_result.overallDecision,
            )
        logger.info(
            "simulation_batch_end requestId=%s timestamp=%s batch=%s "
            "totalBatches=%s personaResults=%s decision=%s launchLoss=%s",
            request_id,
            _utc_timestamp(),
            batch_index,
            total_batches,
            len(batch_result.personaResults),
            batch_result.overallDecision,
            batch_result.launchLoss,
        )

    return _aggregate_simulation_results(
        request_id=request_id,
        personas=personas,
        batch_results=batch_results,
        total_batches=total_batches,
        batch_launch_losses=batch_losses,
    )


def _with_launch_loss(
    result: SimulationResultResponse,
    batch_launch_losses: list[BatchLaunchLoss] | None = None,
) -> SimulationResultResponse:
    loss, breakdown = _calculate_launch_loss(result)
    return result.model_copy(
        update={
            "launchLoss": loss,
            "launchLossBreakdown": breakdown,
            "batchLaunchLosses": batch_launch_losses or result.batchLaunchLosses,
        }
    )


def _calculate_launch_loss(
    result: SimulationResultResponse,
) -> tuple[float, dict[str, float]]:
    persona_count = len(result.personaResults)
    avg_stress = _average_int(item.stressRisk for item in result.personaResults)
    avg_financial = _average_int(
        item.financialWellbeingImpact for item in result.personaResults
    )
    breakdown = {
        "clarity": round((100 - result.clarityScore) / 100, 4),
        "trust": round((100 - result.customerTrustScore) / 100, 4),
        "stress": round(avg_stress / 100, 4) if persona_count else 0,
        "fairness": round(result.fairnessRisk / 100, 4),
        "accessibility": round(result.accessibilityRisk / 100, 4),
        "privacy": round(result.privacyRisk / 100, 4),
        "operational": round(result.operationalRisk / 100, 4),
        "financialWellbeing": round(avg_financial / 100, 4) if persona_count else 0,
    }
    weights = {
        "clarity": 0.18,
        "trust": 0.18,
        "stress": 0.14,
        "fairness": 0.13,
        "accessibility": 0.10,
        "privacy": 0.12,
        "operational": 0.08,
        "financialWellbeing": 0.07,
    }
    loss = sum(breakdown[key] * weight for key, weight in weights.items())
    return round(max(0, min(1, loss)), 4), breakdown


def _aggregate_simulation_results(
    request_id: str,
    personas: list[GeneratedPersona],
    batch_results: list[SimulationResultResponse],
    total_batches: int,
    batch_launch_losses: list[BatchLaunchLoss],
) -> SimulationResultResponse:
    persona_results = [
        result
        for batch in batch_results
        for result in batch.personaResults
    ]
    if not batch_results:
        raise RuntimeError("simulation_batch_error: no batch results")

    decision_rank = {
        "Launch": 0,
        "Revise before release": 1,
        "Do not launch": 2,
    }
    overall_decision = max(
        (batch.overallDecision for batch in batch_results),
        key=lambda decision: decision_rank[decision],
    )
    impact_rank = {"Positive": 0, "Neutral": 1, "Negative": 2}
    financial_impact = max(
        (batch.financialWellbeingImpact for batch in batch_results),
        key=lambda impact: impact_rank[impact],
    )

    top_risks = _unique_ordered(
        risk for batch in batch_results for risk in batch.topRisks
    )[:8]
    top_recommendations = _unique_ordered(
        recommendation
        for batch in batch_results
        for recommendation in batch.topRecommendations
    )[:3]
    while len(top_recommendations) < 3:
        top_recommendations.append(
            "Review high-risk persona reactions before releasing the message."
        )

    affected_personas = sorted(
        persona_results,
        key=lambda item: max(
            item.stressRisk,
            item.fairnessRisk,
            item.accessibilityRisk,
            item.privacyRisk,
            item.operationalRisk,
            100 - item.clarityScore,
            100 - item.trustScore,
        ),
        reverse=True,
    )
    top_affected = [item.personaName for item in affected_personas[:8]]
    def _batch_max_risk(batch: SimulationResultResponse) -> int:
        persona_risk_scores = [
            max(
                item.stressRisk,
                item.fairnessRisk,
                item.accessibilityRisk,
                item.privacyRisk,
                item.operationalRisk,
                100 - item.clarityScore,
                100 - item.trustScore,
            )
            for item in batch.personaResults
        ]
        summary_risk_scores = [
            batch.fairnessRisk,
            batch.accessibilityRisk,
            batch.privacyRisk,
            batch.operationalRisk,
            100 - batch.clarityScore,
            100 - batch.customerTrustScore,
        ]
        return max([*persona_risk_scores, *summary_risk_scores], default=0)

    highest_risk_batch = max(batch_results, key=_batch_max_risk)

    openai_response_ids = _unique_ordered(
        response_id
        for batch in batch_results
        for response_id in (batch.openaiAttemptResponseIds or [])
    )
    rule_based_checks = [
        check
        for batch in batch_results
        for check in batch.ruleBasedChecks
    ]

    aggregated = SimulationResultResponse(
        overallDecision=overall_decision,
        overallSummary=(
            f"Aggregated {len(persona_results)} persona reactions across "
            f"{total_batches} simulation batches. Overall decision reflects "
            "the highest-risk batch and combined persona-level findings."
        ),
        clarityScore=_average_int(batch.clarityScore for batch in batch_results),
        customerTrustScore=_average_int(
            batch.customerTrustScore for batch in batch_results
        ),
        financialWellbeingImpact=financial_impact,
        fairnessRisk=_average_int(batch.fairnessRisk for batch in batch_results),
        accessibilityRisk=_average_int(
            batch.accessibilityRisk for batch in batch_results
        ),
        privacyRisk=_average_int(batch.privacyRisk for batch in batch_results),
        operationalRisk=_average_int(
            batch.operationalRisk for batch in batch_results
        ),
        topRisks=top_risks,
        topAffectedPersonas=top_affected,
        topRecommendations=top_recommendations,
        betterMessage=highest_risk_batch.betterMessage,
        personaResults=persona_results,
        uiScreenshotAnalysis=next(
            (
                batch.uiScreenshotAnalysis
                for batch in batch_results
                if batch.uiScreenshotAnalysis is not None
            ),
            None,
        ),
        ruleBasedChecks=rule_based_checks,
        openaiAttempts=sum(batch.openaiAttempts or 0 for batch in batch_results),
        openaiAttemptResponseIds=openai_response_ids,
        openaiDurationMs=sum(batch.openaiDurationMs or 0 for batch in batch_results),
        postProcessingDurationMs=sum(
            batch.postProcessingDurationMs or 0 for batch in batch_results
        ),
        postProcessingWarning=(
            f"Aggregated from {total_batches} simulation batches for "
            f"{len(personas)} personas."
        ),
        used_openai=all(batch.used_openai for batch in batch_results),
        fallback_reason="; ".join(
            batch.fallback_reason
            for batch in batch_results
            if batch.fallback_reason
        ) or None,
    )
    return _with_launch_loss(
        aggregated,
        batch_launch_losses=batch_launch_losses,
    )


def _average_int(values: object) -> int:
    items = [int(value) for value in values]
    if not items:
        return 0
    return max(0, min(100, round(sum(items) / len(items))))


def _unique_ordered(values: object) -> list:
    seen = set()
    unique = []
    for value in values:
        if value is None or value in seen:
            continue
        seen.add(value)
        unique.append(value)
    return unique


def _initial_simulation_batch_progress(
    personas: list[GeneratedPersona],
) -> list[SimulationBatchProgress]:
    batch_size = _int_env("SIMULATION_BATCH_SIZE", DEFAULT_SIMULATION_BATCH_SIZE)
    progress: list[SimulationBatchProgress] = []
    for batch_index, start in enumerate(range(0, len(personas), batch_size), start=1):
        persona_count = min(batch_size, len(personas) - start)
        progress.append(
            SimulationBatchProgress(
                batchIndex=batch_index,
                personaStart=start + 1,
                personaEnd=start + persona_count,
                personaCount=persona_count,
                status="queued",
            )
        )
    return progress


def _update_simulation_batch_progress(
    job_id: str,
    batch_index: int,
    status: str,
    launch_loss: float | None = None,
    overall_decision: str | None = None,
    error: str | None = None,
) -> None:
    now = _utc_timestamp()
    now_epoch = time.time()
    with SIMULATION_JOBS_LOCK:
        job = SIMULATION_JOBS.get(job_id)
        if job is None:
            return
        updated_progress = []
        for item in job.get("batchProgress", []):
            if item.batchIndex != batch_index:
                updated_progress.append(item)
                continue
            updated_progress.append(
                item.model_copy(
                    update={
                        "status": status,
                        "launchLoss": launch_loss
                        if launch_loss is not None
                        else item.launchLoss,
                        "overallDecision": overall_decision
                        if overall_decision is not None
                        else item.overallDecision,
                        "error": error,
                    }
                )
            )
        job["batchProgress"] = updated_progress
        job["currentBatch"] = batch_index if status == "running" else None
        job["completedBatches"] = sum(
            1 for item in updated_progress if item.status == "completed"
        )
        job["updatedAt"] = now
        job["updatedAtEpoch"] = now_epoch


def _update_simulation_job(
    job_id: str,
    status: str,
    error: str | None,
    result: SimulationResultResponse | None,
) -> None:
    now = _utc_timestamp()
    now_epoch = time.time()
    with SIMULATION_JOBS_LOCK:
        job = SIMULATION_JOBS.get(job_id)
        if job is None:
            return
        job.update(
            {
                "status": status,
                "updatedAt": now,
                "updatedAtEpoch": now_epoch,
                "error": error,
                "result": result,
            }
        )


def _simulation_job_response(job: dict) -> SimulationJobStatusResponse:
    return SimulationJobStatusResponse(
        jobId=job["jobId"],
        status=job["status"],
        createdAt=job["createdAt"],
        updatedAt=job["updatedAt"],
        requestId=job["requestId"],
        error=job.get("error"),
        result=job.get("result"),
        currentBatch=job.get("currentBatch"),
        totalBatches=job.get("totalBatches"),
        completedBatches=job.get("completedBatches", 0),
        batchProgress=job.get("batchProgress", []),
    )


def _cleanup_simulation_jobs_locked(now_epoch: float) -> None:
    expired_job_ids = [
        job_id
        for job_id, job in SIMULATION_JOBS.items()
        if now_epoch - float(job.get("updatedAtEpoch", 0)) > SIMULATION_JOB_TTL_SECONDS
    ]
    for job_id in expired_job_ids:
        SIMULATION_JOBS.pop(job_id, None)

    if len(SIMULATION_JOBS) <= SIMULATION_JOB_LIMIT:
        return

    removable = sorted(
        (
            (job_id, job)
            for job_id, job in SIMULATION_JOBS.items()
            if job.get("status") in {"completed", "failed"}
        ),
        key=lambda item: float(item[1].get("createdAtEpoch", 0)),
    )
    for job_id, _job in removable[: len(SIMULATION_JOBS) - SIMULATION_JOB_LIMIT]:
        SIMULATION_JOBS.pop(job_id, None)


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


def _int_env(name: str, default: int) -> int:
    try:
        return max(1, int(os.getenv(name, str(default))))
    except ValueError:
        return default


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
