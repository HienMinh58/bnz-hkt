export type OverallDecision = "Launch" | "Revise before release" | "Do not launch";
export type FinancialWellbeingImpact = "Negative" | "Neutral" | "Positive";

export interface Persona {
  id: string;
  name: string;
  ageRange: string;
  shortLabel: string;
  tags: string[];
  lifeContext: string;
  incomePattern: string;
  digitalConfidence: string;
  languageNeed: string;
  accessibilityNeed: string;
  financialStress: string;
  privacySensitivity: string;
  bankingContext?: string;
  mainConcern: string;
  likelyMisunderstanding: string;
  supportNeed: string;
  custom?: boolean;
}

export type GeneratedPersona = Persona;

export interface GeneratePersonasResponse {
  personas: GeneratedPersona[];
  used_openai: boolean;
  fallback_reason: string | null;
  requestId?: string | null;
  durationMs?: number | null;
}

export interface AdAnalysisRequest {
  campaignName: string;
  advertisementCopy: string;
  channel: string;
  placement: string;
  campaignContext: string;
}

export interface AdAnalysisResponse {
  productType: string;
  offerAngle: string;
  likelyIntent: string;
  audienceCues: string[];
  behaviorSignals: string[];
  ambiguity: string[];
  audienceHypothesis: string;
  expectedCustomerAction: string;
  used_openai: boolean;
  fallback_reason: string | null;
  requestId?: string | null;
  durationMs?: number | null;
  openaiResponseId?: string | null;
  openaiAttempts?: number | null;
  openaiAttemptResponseIds?: string[] | null;
  openaiDurationMs?: number | null;
}

export interface AudienceFitRequest {
  campaignName: string;
  advertisementCopy: string;
  channel: string;
  placement: string;
  campaignContext: string;
  audienceHypothesis: string;
  audienceCues: string[];
  behaviorSignals: string[];
  profileCount: number;
}

export interface SegmentFitSummary {
  segment_id: number;
  segment_name: string;
  count: number;
  percentage: number;
  average_confidence: number;
}

export interface AudienceFitResponse {
  segments: SegmentFitSummary[];
  profileCount: number;
  primarySegment: string | null;
  segmentationServiceUrl: string;
  used_openai: boolean;
  fallback_reason: string | null;
  requestId?: string | null;
  durationMs?: number | null;
  openaiResponseId?: string | null;
  openaiAttempts?: number | null;
  openaiAttemptResponseIds?: string[] | null;
  openaiDurationMs?: number | null;
}

export interface TriggeredRule {
  ruleId: string;
  description: string;
  impact: string;
}

export interface UIScreenshotAnalysis {
  what_ai_saw: string;
  ui_clarity_issues: string[];
  button_action_issues: string[];
  accessibility_issues: string[];
  recommended_ui_improvements: string[];
}

export interface PersonaSimulationResult {
  personaId: string;
  personaName: string;
  segment: string;
  likelyReaction: string;
  clarityScore: number;
  trustScore: number;
  stressRisk: number;
  fairnessRisk: number;
  accessibilityRisk: number;
  privacyRisk: number;
  financialWellbeingImpact: number;
  operationalRisk: number;
  mainIssues: string[];
  triggeredRules: TriggeredRule[];
  ruleBasedChecks?: TriggeredRule[];
  aiScores?: Record<string, number> | null;
  ruleScores?: Record<string, number> | null;
  finalScores?: Record<string, number> | null;
  adjustedScores?: Record<string, number> | null;
  scoreDiffs?: Record<string, number> | null;
  suggestedImprovement: string;
  betterMessage: string;
}

export interface DevelopmentDebug {
  requestId: string;
  used_openai: boolean;
  fallback_reason: string | null;
  imageUploaded: boolean;
  personaCount: number;
  personaNames: string[];
  hasRawOpenAIResult: boolean;
  openaiResponseId?: string | null;
  openaiAttempts?: number | null;
  openaiAttemptResponseIds?: string[] | null;
  durationMs?: number | null;
  openaiDurationMs?: number | null;
  postProcessingDurationMs?: number | null;
  postProcessingWarning?: string | null;
  rawOpenAIResult?: unknown;
}

export interface SimulationResponse {
  overallDecision: OverallDecision;
  overallSummary: string;
  clarityScore: number;
  customerTrustScore: number;
  financialWellbeingImpact: FinancialWellbeingImpact;
  fairnessRisk: number;
  accessibilityRisk: number;
  privacyRisk: number;
  operationalRisk: number;
  topRisks: string[];
  topAffectedPersonas: string[];
  topRecommendations: string[];
  betterMessage: string;
  personaResults: PersonaSimulationResult[];
  uiScreenshotAnalysis: UIScreenshotAnalysis | null;
  ruleBasedChecks?: TriggeredRule[];
  aiScores?: Record<string, number> | null;
  ruleScores?: Record<string, number> | null;
  finalScores?: Record<string, number> | null;
  adjustedScores?: Record<string, number> | null;
  scoreDiffs?: Record<string, number> | null;
  rawOpenAIResult?: unknown;
  requestId?: string | null;
  durationMs?: number | null;
  openaiDurationMs?: number | null;
  postProcessingDurationMs?: number | null;
  openaiResponseId?: string | null;
  openaiAttempts?: number | null;
  openaiAttemptResponseIds?: string[] | null;
  postProcessingWarning?: string | null;
  developmentDebug?: DevelopmentDebug | null;
  used_openai: boolean;
  fallback_reason: string | null;
}

export type SimulationJobStatus = "queued" | "running" | "completed" | "failed";

export interface SimulationJobCreateResponse {
  jobId: string;
  status: SimulationJobStatus;
  requestId: string;
}

export interface SimulationJobStatusResponse {
  jobId: string;
  status: SimulationJobStatus;
  createdAt: string;
  updatedAt: string;
  requestId: string;
  error?: string | null;
  result?: SimulationResponse | null;
}

export interface FeatureTestInput {
  featureName: string;
  featureDescription: string;
  customerFacingCopy: string;
  targetCustomerSegment: string;
  channel: string;
  shownTiming: string;
  expectedCustomerAction: string;
  dataUsedShared: string;
  riskFocus: string[];
  personaCount: number;
  screenshot: File | null;
}


export interface SimulationForm {
  featureName: string;
  bankingMessage: string;
  targetCustomers: string;
  channel: string;
  sendTiming: string;
  personaCount: number;
  screenshot: File | null;
}

export type AdvisorChatRole = "user" | "assistant";

export interface AdvisorChatMessage {
  role: AdvisorChatRole;
  content: string;
}

export interface AdvisorCampaignInput {
  featureName: string;
  featureDescription: string;
  customerFacingCopy: string;
  targetCustomerSegment: string;
  channel: string;
  shownTiming: string;
  expectedCustomerAction: string;
  dataUsedShared: string;
  riskFocus: string[];
  personaCount: number;
  screenshotUploaded: boolean;
  screenshotName: string | null;
}

export interface AdvisorChatRequest {
  campaignInput: AdvisorCampaignInput;
  personas: GeneratedPersona[];
  simulationResult: SimulationResponse;
  messages: AdvisorChatMessage[];
}

export interface AdvisorChatResponse {
  answer: string;
  suggestedPrompts: string[];
  used_openai: boolean;
  fallback_reason: string | null;
  requestId?: string | null;
  durationMs?: number | null;
  openaiResponseId?: string | null;
  openaiAttempts?: number | null;
  openaiAttemptResponseIds?: string[] | null;
  openaiDurationMs?: number | null;
}
