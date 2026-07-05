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
    openaiResponseId: str | None = None
    openaiAttempts: int | None = None
    postProcessingWarning: str | None = None
    developmentDebug: DevelopmentDebug | None = None
    used_openai: bool
    fallback_reason: str | None
