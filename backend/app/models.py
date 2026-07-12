from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


OverallDecision = Literal["Launch", "Revise before release", "Do not launch"]
OverallImpact = Literal["Negative", "Neutral", "Positive"]


class StrictBaseModel(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class LegacyPersona(StrictBaseModel):
    name: str
    segment: str
    income_pattern: str
    balance: float
    upcoming_bills: list[str]
    financial_confidence: str
    language_clarity_need: str
    risk_context: str


class GeneratedPersona(StrictBaseModel):
    id: str
    name: str
    ageRange: str
    shortLabel: str
    tags: list[str]
    lifeContext: str
    incomePattern: str
    digitalConfidence: str
    languageNeed: str
    accessibilityNeed: str
    financialStress: str
    privacySensitivity: str
    bankingContext: str | None = None
    mainConcern: str
    likelyMisunderstanding: str
    supportNeed: str
    custom: bool | None = None


class GeneratePersonasRequest(StrictBaseModel):
    featureName: str
    bankingMessage: str
    targetCustomers: str
    channel: str
    sendTiming: str
    personaCount: int = Field(ge=1, le=100)


class GeneratePersonasResponse(StrictBaseModel):
    personas: list[GeneratedPersona]
    used_openai: bool
    fallback_reason: str | None
    requestId: str | None = None
    durationMs: int | None = None


class AdAnalysisRequest(StrictBaseModel):
    campaignName: str
    advertisementCopy: str
    channel: str
    placement: str
    campaignContext: str


class AdAnalysisResponse(StrictBaseModel):
    productType: str
    offerAngle: str
    likelyIntent: str
    audienceCues: list[str]
    behaviorSignals: list[str]
    ambiguity: list[str]
    audienceHypothesis: str
    expectedCustomerAction: str
    used_openai: bool
    fallback_reason: str | None
    requestId: str | None = None
    durationMs: int | None = None
    openaiResponseId: str | None = None
    openaiAttempts: int | None = None
    openaiAttemptResponseIds: list[str] | None = None
    openaiDurationMs: int | None = None


class CustomerFeatureRecord(StrictBaseModel):
    customer_id: str | None = None
    avg_monthly_inflow_6m: float = Field(ge=0)
    salary_inflow_ratio: float = Field(ge=0, le=1)
    inflow_cv_6m: float = Field(ge=0)
    avg_balance_6m: float = Field(ge=0)
    min_balance_6m: float = Field(ge=0)
    avg_monthly_spend_6m: float = Field(ge=0)
    monthly_txn_count_6m: float = Field(ge=0)
    digital_txn_ratio: float = Field(ge=0, le=1)
    cash_withdrawal_ratio: float = Field(ge=0, le=1)
    discretionary_spend_ratio: float = Field(ge=0, le=1)
    travel_spend_ratio: float = Field(ge=0, le=1)
    investment_contribution_ratio: float = Field(ge=0, le=1)
    credit_card_utilisation: float = Field(ge=0, le=1)
    days_since_last_txn: float = Field(ge=0)
    monthly_app_logins_3m: float = Field(ge=0)
    products_held: float = Field(ge=0)
    overdraft_events_6m: float = Field(ge=0)


class SyntheticFeatureProfilesResponse(StrictBaseModel):
    profiles: list[CustomerFeatureRecord]
    used_openai: bool
    fallback_reason: str | None


class AudienceFitRequest(StrictBaseModel):
    campaignName: str
    advertisementCopy: str
    channel: str
    placement: str
    campaignContext: str
    audienceHypothesis: str
    audienceCues: list[str]
    behaviorSignals: list[str]
    profileCount: int = Field(ge=1, le=100)


class SegmentFitSummary(StrictBaseModel):
    segment_id: int
    segment_name: str
    count: int
    percentage: float
    average_confidence: float


class AudienceFitResponse(StrictBaseModel):
    segments: list[SegmentFitSummary]
    profileCount: int
    primarySegment: str | None
    segmentationServiceUrl: str
    used_openai: bool
    fallback_reason: str | None
    requestId: str | None = None
    durationMs: int | None = None
    openaiResponseId: str | None = None
    openaiAttempts: int | None = None
    openaiAttemptResponseIds: list[str] | None = None
    openaiDurationMs: int | None = None


class TriggeredRule(StrictBaseModel):
    ruleId: str
    description: str
    impact: str


class UIScreenshotAnalysis(StrictBaseModel):
    what_ai_saw: str
    ui_clarity_issues: list[str]
    button_action_issues: list[str]
    accessibility_issues: list[str]
    recommended_ui_improvements: list[str]


class DevelopmentDebug(StrictBaseModel):
    requestId: str
    used_openai: bool
    fallback_reason: str | None
    imageUploaded: bool
    personaCount: int
    personaNames: list[str]
    hasRawOpenAIResult: bool
    openaiResponseId: str | None = None
    openaiAttempts: int | None = None
    openaiAttemptResponseIds: list[str] | None = None
    durationMs: int | None = None
    openaiDurationMs: int | None = None
    postProcessingDurationMs: int | None = None
    postProcessingWarning: str | None = None
    rawOpenAIResult: dict[str, Any] | None = None


class PersonaSimulationResult(StrictBaseModel):
    personaId: str
    personaName: str
    segment: str
    likelyReaction: str
    clarityScore: int = Field(ge=0, le=100)
    trustScore: int = Field(ge=0, le=100)
    stressRisk: int = Field(ge=0, le=100)
    fairnessRisk: int = Field(ge=0, le=100)
    accessibilityRisk: int = Field(ge=0, le=100)
    privacyRisk: int = Field(ge=0, le=100)
    financialWellbeingImpact: int = Field(ge=0, le=100)
    operationalRisk: int = Field(ge=0, le=100)
    mainIssues: list[str]
    triggeredRules: list[TriggeredRule]
    ruleBasedChecks: list[TriggeredRule] = Field(default_factory=list)
    aiScores: dict[str, int] | None = None
    ruleScores: dict[str, int] | None = None
    finalScores: dict[str, int] | None = None
    adjustedScores: dict[str, int] | None = None
    scoreDiffs: dict[str, int] | None = None
    suggestedImprovement: str
    betterMessage: str


class SimulationResultResponse(StrictBaseModel):
    overallDecision: OverallDecision
    overallSummary: str
    clarityScore: int = Field(ge=0, le=100)
    customerTrustScore: int = Field(ge=0, le=100)
    financialWellbeingImpact: OverallImpact
    fairnessRisk: int = Field(ge=0, le=100)
    accessibilityRisk: int = Field(ge=0, le=100)
    privacyRisk: int = Field(ge=0, le=100)
    operationalRisk: int = Field(ge=0, le=100)
    topRisks: list[str]
    topAffectedPersonas: list[str]
    topRecommendations: list[str] = Field(min_length=3, max_length=3)
    betterMessage: str
    personaResults: list[PersonaSimulationResult]
    uiScreenshotAnalysis: UIScreenshotAnalysis | None
    ruleBasedChecks: list[TriggeredRule] = Field(default_factory=list)
    aiScores: dict[str, int] | None = None
    ruleScores: dict[str, int] | None = None
    finalScores: dict[str, int] | None = None
    adjustedScores: dict[str, int] | None = None
    scoreDiffs: dict[str, int] | None = None
    rawOpenAIResult: dict[str, Any] | None = None
    requestId: str | None = None
    durationMs: int | None = None
    openaiDurationMs: int | None = None
    postProcessingDurationMs: int | None = None
    openaiResponseId: str | None = None
    openaiAttempts: int | None = None
    openaiAttemptResponseIds: list[str] | None = None
    postProcessingWarning: str | None = None
    developmentDebug: DevelopmentDebug | None = None
    used_openai: bool
    fallback_reason: str | None
