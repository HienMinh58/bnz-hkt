import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  BrainCircuit,
  CheckCircle2,
  ImageUp,
  Loader2,
  Network,
  ShieldCheck,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import ForceGraph2D, {
  type ForceGraphMethods,
  type LinkObject,
  type NodeObject,
} from "react-force-graph-2d";
import {
  analyzeAd,
  askSimulationAdvisor,
  generateAudienceFit,
  generatePersonas,
  runSimulation,
} from "../api/client";
import type {
  AdAnalysisResponse,
  AdvisorCampaignInput,
  AdvisorChatMessage,
  AudienceFitResponse,
  FeatureTestInput,
  GeneratedPersona,
  Persona,
  PersonaSimulationResult,
  SimulationResponse,
} from "../types/simulation";

const defaultRiskFocus = [
  "Clarity",
  "Trust",
  "Privacy",
  "Accessibility",
  "Operational risk",
  "Consent / data sharing",
];

const riskFocusOptions = [
  "Clarity",
  "Trust",
  "Stress",
  "Fairness",
  "Accessibility",
  "Privacy",
  "Financial wellbeing",
  "Operational risk",
  "Consent / data sharing",
  "Scam / fraud risk",
];

const defaultForm: FeatureTestInput = {
  featureName: "",
  featureDescription: "",
  customerFacingCopy: "",
  targetCustomerSegment: "",
  channel: "Mobile in-app screen",
  shownTiming: "",
  expectedCustomerAction: "",
  dataUsedShared: "",
  riskFocus: defaultRiskFocus,
  personaCount: 12,
  screenshot: null,
};

const channels = [
  "Mobile in-app screen",
  "Mobile push notification",
  "Lock-screen notification preview",
  "Web banking page",
  "Partner embedded flow",
  "Staff / internal dashboard",
  "Email",
  "SMS",
];

const personaFilterTags = [
  "Everyday customer",
  "Financial vulnerability",
  "Irregular income",
  "Low digital confidence",
  "English as an additional language",
  "Accessibility needs",
  "Older customers",
  "New-to-bank customers",
  "Shared household finances",
  "Privacy-sensitive",
  "Small business overlap",
  "Rural or limited connectivity",
  "Operational risk",
];

const predefinedPersonas: Persona[] = [
  {
    id: "first-home-mover",
    name: "Sophie",
    ageRange: "30-39",
    shortLabel: "First-home mover",
    tags: ["Everyday customer", "Privacy-sensitive", "Operational risk"],
    lifeContext: "Moving into a first home and setting up power, insurance, and mortgage-related payments.",
    incomePattern: "Stable salary with high fixed commitments",
    digitalConfidence: "High",
    languageNeed: "Low",
    accessibilityNeed: "None",
    financialStress: "Medium",
    privacySensitivity: "High",
    bankingContext: "Uses mobile banking frequently and tracks settlement-related payments closely.",
    mainConcern: "Needs confidence that provider setup and direct debit consent are correct before anything starts.",
    likelyMisunderstanding: "May assume confirming setup means the first payment is taken immediately.",
    supportNeed: "Clear review screen, edit option, and confirmation timing.",
  },
  {
    id: "renter-moving-flats",
    name: "Noah",
    ageRange: "20-29",
    shortLabel: "Renter moving flats",
    tags: ["Everyday customer", "Shared household finances", "Financial vulnerability"],
    lifeContext: "Moving flats with shared bills and overlapping bond, rent, and setup costs.",
    incomePattern: "Regular wages with short-term cash pressure",
    digitalConfidence: "Medium",
    languageNeed: "Low",
    accessibilityNeed: "None",
    financialStress: "High",
    privacySensitivity: "Medium",
    mainConcern: "Wants to avoid duplicate payments or accidentally taking responsibility for the full household bill.",
    likelyMisunderstanding: "May not notice whose name the utility account or direct debit will be under.",
    supportNeed: "Plain ownership wording and visible cancel/back controls.",
  },
  {
    id: "gig-worker",
    name: "Mia",
    ageRange: "25-34",
    shortLabel: "Gig worker",
    tags: ["Irregular income", "Financial vulnerability", "Operational risk"],
    lifeContext: "Balances app-based work income with bills that fall on fixed dates.",
    incomePattern: "Irregular deposits and variable weekly income",
    digitalConfidence: "High",
    languageNeed: "Low",
    accessibilityNeed: "None",
    financialStress: "High",
    privacySensitivity: "Medium",
    mainConcern: "Needs setup timing and first payment date to fit unpredictable cash flow.",
    likelyMisunderstanding: "May think BNZ can predict future gig income or provider billing exactly.",
    supportNeed: "Flexible timing, clear first payment date, and reminders before money moves.",
  },
  {
    id: "family-budget-manager",
    name: "Tane",
    ageRange: "35-44",
    shortLabel: "Family budget manager",
    tags: ["Everyday customer", "Shared household finances", "Financial vulnerability"],
    lifeContext: "Manages household bills, childcare costs, and grocery planning across pay cycles.",
    incomePattern: "Salary plus variable family support payments",
    digitalConfidence: "Medium",
    languageNeed: "Low",
    accessibilityNeed: "None",
    financialStress: "Medium",
    privacySensitivity: "Medium",
    mainConcern: "Needs to know whether confirming will affect the household budget this week.",
    likelyMisunderstanding: "May miss data-sharing details if they are below the main action.",
    supportNeed: "Budget impact summary and clear data sharing notice.",
  },
  {
    id: "recent-graduate",
    name: "Leo",
    ageRange: "20-29",
    shortLabel: "Recent graduate",
    tags: ["Everyday customer", "New-to-bank customers"],
    lifeContext: "Recently started full-time work and is setting up independent bills for the first time.",
    incomePattern: "Stable entry-level salary",
    digitalConfidence: "High",
    languageNeed: "Low",
    accessibilityNeed: "None",
    financialStress: "Medium",
    privacySensitivity: "Medium",
    mainConcern: "Needs a simple explanation of direct debit and what can be changed later.",
    likelyMisunderstanding: "May treat direct debit as a one-off payment rather than an ongoing authority.",
    supportNeed: "Short definitions and a review-before-confirm pattern.",
  },
  {
    id: "older-customer",
    name: "Margaret",
    ageRange: "70-79",
    shortLabel: "Older customer",
    tags: ["Older customers", "Low digital confidence", "Accessibility needs"],
    lifeContext: "Uses digital banking for essentials but prefers careful, familiar steps.",
    incomePattern: "Fixed pension income",
    digitalConfidence: "Low",
    languageNeed: "Medium",
    accessibilityNeed: "Larger text and clear step-by-step flow",
    financialStress: "Medium",
    privacySensitivity: "High",
    mainConcern: "Needs reassurance that nothing starts until she confirms.",
    likelyMisunderstanding: "May be unsure whether BNZ or the provider is asking for consent.",
    supportNeed: "Step-by-step copy, larger touch targets, and support contact.",
  },
  {
    id: "new-to-bank-customer",
    name: "Aria",
    ageRange: "25-34",
    shortLabel: "New-to-bank",
    tags: ["New-to-bank customers", "Trust", "Operational risk"],
    lifeContext: "Recently opened a BNZ account and has not used connected provider services before.",
    incomePattern: "Stable salary",
    digitalConfidence: "Medium",
    languageNeed: "Low",
    accessibilityNeed: "None",
    financialStress: "Low",
    privacySensitivity: "High",
    mainConcern: "Needs to understand why BNZ is involved in a partner utility flow.",
    likelyMisunderstanding: "May assume Mercury can see more banking data than intended.",
    supportNeed: "Trust cues, BNZ branding, and explicit data boundaries.",
  },
  {
    id: "eal-customer",
    name: "Mei",
    ageRange: "30-39",
    shortLabel: "Additional language",
    tags: ["English as an additional language", "Accessibility needs", "New-to-bank customers"],
    lifeContext: "Comfortable with digital services but prefers plain English for banking and consent wording.",
    incomePattern: "Stable income",
    digitalConfidence: "Medium",
    languageNeed: "High",
    accessibilityNeed: "Plain language",
    financialStress: "Medium",
    privacySensitivity: "High",
    mainConcern: "Needs consent, data sharing, and direct debit terms to be unambiguous.",
    likelyMisunderstanding: "May misread 'continue' as final consent rather than review.",
    supportNeed: "Plain language, short sentences, and clear confirm/cancel labels.",
  },
  {
    id: "accessibility-needs-customer",
    name: "Jordan",
    ageRange: "40-49",
    shortLabel: "Assistive tech user",
    tags: ["Accessibility needs", "Operational risk"],
    lifeContext: "Uses screen reader and keyboard navigation for banking tasks.",
    incomePattern: "Regular salary",
    digitalConfidence: "High",
    languageNeed: "Low",
    accessibilityNeed: "Screen reader support and logical focus order",
    financialStress: "Low",
    privacySensitivity: "Medium",
    mainConcern: "Needs form controls, consent wording, and confirmation actions to be accessible.",
    likelyMisunderstanding: "May miss provider/data details if they are visually styled but not programmatically clear.",
    supportNeed: "Accessible labels, focus order, and non-visual status updates.",
  },
  {
    id: "rebuilding-finances",
    name: "Aroha",
    ageRange: "30-39",
    shortLabel: "Rebuilding finances",
    tags: ["Financial vulnerability", "Privacy-sensitive", "Operational risk"],
    lifeContext: "Rebuilding savings after missed bills and trying to avoid new payment stress.",
    incomePattern: "Regular but tight income",
    digitalConfidence: "Medium",
    languageNeed: "Medium",
    accessibilityNeed: "None",
    financialStress: "High",
    privacySensitivity: "High",
    mainConcern: "Needs to know how the setup affects future payments and what happens if money is short.",
    likelyMisunderstanding: "May think cancellation is difficult once the setup starts.",
    supportNeed: "Supportive wording, payment timing, and easy cancellation path.",
  },
  {
    id: "shared-household-organiser",
    name: "Priya",
    ageRange: "35-44",
    shortLabel: "Shared household",
    tags: ["Shared household finances", "Privacy-sensitive", "Everyday customer"],
    lifeContext: "Coordinates bills with a partner and flatmates using a shared device at times.",
    incomePattern: "Stable salary",
    digitalConfidence: "High",
    languageNeed: "Low",
    accessibilityNeed: "None",
    financialStress: "Medium",
    privacySensitivity: "High",
    mainConcern: "Needs notification previews and screens to avoid exposing account or utility details.",
    likelyMisunderstanding: "May not realise direct debit details are private to the selected account holder.",
    supportNeed: "Discreet notification previews and privacy-first copy.",
  },
  {
    id: "small-business-owner",
    name: "James",
    ageRange: "45-54",
    shortLabel: "Small business owner",
    tags: ["Small business overlap", "Irregular income", "Operational risk"],
    lifeContext: "Uses personal and business accounts and sometimes pays utilities from business cash flow.",
    incomePattern: "Large irregular invoice payments",
    digitalConfidence: "High",
    languageNeed: "Low",
    accessibilityNeed: "None",
    financialStress: "Medium",
    privacySensitivity: "Medium",
    mainConcern: "Needs to avoid selecting the wrong account or mixing personal and business payments.",
    likelyMisunderstanding: "May assume provider setup can pull from multiple accounts or invoice timing.",
    supportNeed: "Account confirmation, provider details, and edit controls.",
  },
  {
    id: "rural-connectivity",
    name: "Hana",
    ageRange: "50-59",
    shortLabel: "Rural connectivity",
    tags: ["Rural or limited connectivity", "Operational risk", "Low digital confidence"],
    lifeContext: "Lives rurally with intermittent mobile coverage and sometimes completes tasks later.",
    incomePattern: "Seasonal household income",
    digitalConfidence: "Medium",
    languageNeed: "Low",
    accessibilityNeed: "None",
    financialStress: "Medium",
    privacySensitivity: "Medium",
    mainConcern: "Needs confidence the flow saves progress and does not duplicate setup if connection drops.",
    likelyMisunderstanding: "May retry after a timeout and accidentally submit twice if status is unclear.",
    supportNeed: "Clear progress status, retry safety, and offline-friendly messaging.",
  },
  {
    id: "new-migrant",
    name: "Samir",
    ageRange: "30-39",
    shortLabel: "New migrant",
    tags: ["English as an additional language", "New-to-bank customers", "Privacy-sensitive"],
    lifeContext: "Recently moved to New Zealand and is learning local utility and banking processes.",
    incomePattern: "Stable income but new payment obligations",
    digitalConfidence: "Medium",
    languageNeed: "High",
    accessibilityNeed: "Plain language",
    financialStress: "Medium",
    privacySensitivity: "High",
    mainConcern: "Needs local terms like direct debit, provider consent, and bank verification explained.",
    likelyMisunderstanding: "May think BNZ is choosing the utility provider rather than enabling setup.",
    supportNeed: "Plain-language terms and clear distinction between BNZ and partner responsibilities.",
  },
  {
    id: "privacy-conscious-digital",
    name: "Olivia",
    ageRange: "25-34",
    shortLabel: "Privacy-conscious",
    tags: ["Privacy-sensitive", "Everyday customer"],
    lifeContext: "Confident digital user who reads privacy notices before connecting services.",
    incomePattern: "Stable salary",
    digitalConfidence: "High",
    languageNeed: "Low",
    accessibilityNeed: "None",
    financialStress: "Low",
    privacySensitivity: "High",
    mainConcern: "Needs precise data minimisation and consent language before continuing.",
    likelyMisunderstanding: "May assume data sharing starts before explicit confirmation.",
    supportNeed: "Concise data use summary and clear consent boundary.",
  },
  {
    id: "community-support",
    name: "Wiremu",
    ageRange: "55-64",
    shortLabel: "Community support",
    tags: ["Financial vulnerability", "Low digital confidence", "Shared household finances"],
    lifeContext: "Often gets help from family or community support workers to manage admin tasks.",
    incomePattern: "Fixed income with occasional support payments",
    digitalConfidence: "Low",
    languageNeed: "Medium",
    accessibilityNeed: "Step-by-step support",
    financialStress: "High",
    privacySensitivity: "High",
    mainConcern: "Needs to complete setup without exposing unnecessary bank details to helpers.",
    likelyMisunderstanding: "May not know which details are safe to share when someone assists.",
    supportNeed: "Assisted-use privacy guidance and simple confirmation summary.",
  },
];

type ActiveTab = "input" | "graph" | "results";
type PersonaSetupMode = "auto" | "manual";

function riskClass(value: string | number) {
  const normalized = String(value).toLowerCase();
  const numeric = typeof value === "number" ? value : Number.NaN;
  if (
    normalized === "low" ||
    normalized === "positive" ||
    normalized === "launch" ||
    (!Number.isNaN(numeric) && numeric < 40)
  ) {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (
    normalized === "medium" ||
    normalized === "neutral" ||
    normalized === "revise before release" ||
    (!Number.isNaN(numeric) && numeric < 70)
  ) {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  return "border-rose-200 bg-rose-50 text-rose-700";
}

function riskLabel(score: number) {
  if (score >= 70) return "High";
  if (score >= 40) return "Medium";
  return "Low";
}

function mainPersonaRisk(result: PersonaSimulationResult) {
  const risks = [
    { label: "Stress", score: result.stressRisk },
    { label: "Accessibility", score: result.accessibilityRisk },
    { label: "Operational", score: result.operationalRisk },
    { label: "Privacy", score: result.privacyRisk },
    { label: "Clarity", score: 100 - result.clarityScore },
    { label: "Trust", score: 100 - result.trustScore },
  ].sort((a, b) => b.score - a.score);
  return risks[0];
}

function primaryWhy(result: PersonaSimulationResult) {
  return result.mainIssues[0] ?? "No major risk surfaced for this persona.";
}

function Badge({ value }: { value: string | number }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${riskClass(
        value,
      )}`}
    >
      {value}
    </span>
  );
}

function ScoreCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-panel">
      <div className="text-sm font-medium text-slate-500">{label}</div>
      <div className="mt-2 flex items-end justify-between gap-3">
        <div className="text-2xl font-bold text-slate-950">{value}</div>
        {/^\d+/.test(value) ? (
          <BadgeCheck className="h-5 w-5 text-bnz-500" />
        ) : (
          <Badge value={value} />
        )}
      </div>
      {detail ? <p className="mt-2 text-sm text-slate-500">{detail}</p> : null}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-slate-700">{label}</span>
      <div className="mt-2">{children}</div>
    </label>
  );
}

function nodeRiskClasses(persona: GeneratedPersona, selected: boolean) {
  const stress = persona.financialStress.toLowerCase();
  if (selected) {
    return "border-bnz-700 ring-4 ring-bnz-100";
  }
  if (stress === "high") {
    return "border-rose-300 ring-4 ring-rose-50";
  }
  if (stress === "medium") {
    return "border-amber-300 ring-4 ring-amber-50";
  }
  return "border-emerald-300 ring-4 ring-emerald-50";
}

function nodeBadgeClasses(persona: GeneratedPersona) {
  const stress = persona.financialStress.toLowerCase();
  if (stress === "high") return "bg-rose-500";
  if (stress === "medium") return "bg-amber-500";
  return "bg-emerald-500";
}

type PersonaGroup = {
  id: string;
  label: string;
  riskSummary: string;
  personas: GeneratedPersona[];
};

type GraphNode = {
  id: string;
  type: "parent" | "group" | "persona";
  x: number;
  y: number;
  label: string;
  data?: GeneratedPersona | PersonaGroup | { targetSegment: string };
};

type GraphEdge = {
  id: string;
  source: string;
  target: string;
};

type GraphLayout = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  height: number;
  minWidth: number;
};

type AdAnalysisPreview = {
  productType: string;
  offerAngle: string;
  likelyIntent: string;
  audienceCues: string[];
  behaviorSignals: string[];
  ambiguity: string[];
  hypothesis: string;
  expectedAction: string;
  usedOpenAI?: boolean;
  fallbackReason?: string | null;
};

function includesAny(value: string, terms: string[]) {
  return terms.some((term) => value.includes(term));
}

function buildAdAnalysisPreview(form: FeatureTestInput): AdAnalysisPreview {
  const text = [
    form.featureName,
    form.featureDescription,
    form.customerFacingCopy,
    form.channel,
    form.shownTiming,
  ]
    .join(" ")
    .toLowerCase();

  const productType = includesAny(text, ["credit card", "card", "cashback", "points", "rewards"])
    ? "Credit card / rewards offer"
    : includesAny(text, ["home loan", "mortgage", "refinance"])
      ? "Home lending campaign"
      : includesAny(text, ["save", "savings", "term deposit", "interest rate"])
        ? "Savings or deposit campaign"
        : includesAny(text, ["invest", "portfolio", "wealth", "kiwisaver"])
          ? "Investment / wealth campaign"
          : includesAny(text, ["loan", "overdraft", "repay", "debt"])
            ? "Credit or cashflow support"
            : "General banking campaign";

  const offerAngle = includesAny(text, ["travel", "flight", "hotel", "dining", "restaurant"])
    ? "Lifestyle and rewards"
    : includesAny(text, ["cashback", "discount", "deal", "save", "no fee"])
      ? "Value and cost saving"
      : includesAny(text, ["security", "fraud", "protect", "safe"])
        ? "Trust and protection"
        : includesAny(text, ["fast", "instant", "easy", "app", "digital"])
          ? "Convenience and digital ease"
          : "Product benefit awareness";

  const likelyIntent = includesAny(text, ["apply", "join", "switch", "open", "sign up"])
    ? "Conversion"
    : includesAny(text, ["upgrade", "increase", "premium", "platinum"])
      ? "Upsell"
      : includesAny(text, ["remind", "renew", "keep", "continue"])
        ? "Retention"
        : "Consideration";

  const audienceCues = [
    includesAny(text, ["app", "online", "digital", "mobile"]) ? "Digital-first customers" : null,
    includesAny(text, ["travel", "dining", "shopping", "lifestyle"]) ? "Lifestyle-led spenders" : null,
    includesAny(text, ["premium", "platinum", "wealth", "invest"]) ? "Higher-value customers" : null,
    includesAny(text, ["save", "budget", "no fee", "cashback"]) ? "Value-conscious customers" : null,
    includesAny(text, ["home", "mortgage", "family"]) ? "Household decision makers" : null,
  ].filter(Boolean) as string[];

  const behaviorSignals = [
    includesAny(text, ["credit card", "card", "points", "rewards"]) ? "Credit-active behavior" : null,
    includesAny(text, ["travel", "dining", "shopping"]) ? "Discretionary spending" : null,
    includesAny(text, ["save", "savings", "deposit"]) ? "Savings-oriented behavior" : null,
    includesAny(text, ["invest", "wealth", "portfolio"]) ? "Investment interest" : null,
    includesAny(text, ["overdraft", "loan", "repay"]) ? "Cashflow or borrowing need" : null,
  ].filter(Boolean) as string[];

  const ambiguity = [
    !includesAny(text, ["low income", "high income", "premium", "student", "business", "family"])
      ? "Income level is not explicit."
      : null,
    !includesAny(text, ["app", "email", "sms", "branch", "web", "mobile"])
      ? "Preferred channel is weakly stated."
      : null,
    !includesAny(text, ["urgent", "limited time", "today", "deadline"])
      ? "Timing pressure is not clear."
      : null,
  ].filter(Boolean) as string[];

  const hypothesis =
    audienceCues.length || behaviorSignals.length
      ? `Likely audience: ${[...audienceCues, ...behaviorSignals]
          .slice(0, 4)
          .join(", ")
          .toLowerCase()}.`
      : "Likely audience: customers whose banking behavior aligns with the offer, channel, and action requested by this campaign.";

  return {
    productType,
    offerAngle,
    likelyIntent,
    audienceCues: audienceCues.length ? audienceCues : ["No strong audience cue yet"],
    behaviorSignals: behaviorSignals.length ? behaviorSignals : ["No strong behavior signal yet"],
    ambiguity: ambiguity.length ? ambiguity : ["No major ambiguity detected from the current text."],
    hypothesis,
    expectedAction:
      likelyIntent === "Conversion"
        ? "Review the offer and start an application or sign-up flow."
        : likelyIntent === "Upsell"
          ? "Compare the upgraded offer and decide whether to proceed."
          : "Understand the offer and decide whether it is relevant.",
  };
}

function fromAdAnalysisResponse(response: AdAnalysisResponse): AdAnalysisPreview {
  return {
    productType: response.productType,
    offerAngle: response.offerAngle,
    likelyIntent: response.likelyIntent,
    audienceCues: response.audienceCues,
    behaviorSignals: response.behaviorSignals,
    ambiguity: response.ambiguity,
    hypothesis: response.audienceHypothesis,
    expectedAction: response.expectedCustomerAction,
    usedOpenAI: response.used_openai,
    fallbackReason: response.fallback_reason,
  };
}

function getPersonaGraphLayout(
  personas: GeneratedPersona[],
  targetSegment: string,
  expandedGroupIds: Set<string>,
): GraphLayout {
  if (personas.length <= 6) {
    return createDirectFanoutLayout(personas, targetSegment);
  }
  if (personas.length <= 12) {
    return createTwoColumnFanoutLayout(personas, targetSegment);
  }
  if (personas.length <= 30) {
    return createGroupedLayout(personas, targetSegment, expandedGroupIds);
  }
  return createCollapsedGroupedLayout(personas, targetSegment);
}

function parentNode(targetSegment: string): GraphNode {
  return {
    id: "target",
    type: "parent",
    x: 12,
    y: 50,
    label: "Target User",
    data: { targetSegment },
  };
}

function createDirectFanoutLayout(
  personas: GeneratedPersona[],
  targetSegment: string,
): GraphLayout {
  const ySlots: Record<number, number[]> = {
    1: [50],
    2: [38, 62],
    3: [28, 50, 72],
    4: [22, 42, 60, 80],
    5: [18, 34, 50, 66, 82],
    6: [16, 30, 44, 58, 72, 86],
  };
  const nodes = [
    parentNode(targetSegment),
    ...personas.map((persona, index) => ({
      id: persona.id,
      type: "persona" as const,
      x: index % 2 === 0 ? 68 : 76,
      y: ySlots[personas.length]?.[index] ?? 50,
      label: persona.name,
      data: persona,
    })),
  ];
  return {
    nodes,
    edges: personas.map((persona) => ({
      id: `target-${persona.id}`,
      source: "target",
      target: persona.id,
    })),
    height: 500,
    minWidth: 720,
  };
}

function createTwoColumnFanoutLayout(
  personas: GeneratedPersona[],
  targetSegment: string,
): GraphLayout {
  const firstColumn = personas.slice(0, Math.ceil(personas.length / 2));
  const secondColumn = personas.slice(firstColumn.length);
  const columnNodes = [
    ...positionColumn(firstColumn, 58),
    ...positionColumn(secondColumn, 84),
  ];
  return {
    nodes: [parentNode(targetSegment), ...columnNodes],
    edges: personas.map((persona) => ({
      id: `target-${persona.id}`,
      source: "target",
      target: persona.id,
    })),
    height: 620,
    minWidth: 900,
  };
}

function positionColumn(personas: GeneratedPersona[], x: number): GraphNode[] {
  const gap = personas.length > 1 ? 72 / (personas.length - 1) : 0;
  return personas.map((persona, index) => ({
    id: persona.id,
    type: "persona",
    x,
    y: personas.length === 1 ? 50 : 14 + gap * index,
    label: persona.name,
    data: persona,
  }));
}

function createGroupedLayout(
  personas: GeneratedPersona[],
  targetSegment: string,
  expandedGroupIds: Set<string>,
): GraphLayout {
  const groups = groupPersonas(personas);
  const visiblePersonaNodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const groupGap = groups.length > 1 ? 78 / (groups.length - 1) : 0;
  const groupNodes = groups.map((group, groupIndex) => {
    const groupY = groups.length === 1 ? 50 : 11 + groupGap * groupIndex;
    edges.push({ id: `target-${group.id}`, source: "target", target: group.id });
    const expanded = expandedGroupIds.has(group.id);
    const shownPersonas = expanded ? group.personas : group.personas.slice(0, 4);
    const personaGap = shownPersonas.length > 1 ? 16 / (shownPersonas.length - 1) : 0;
    shownPersonas.forEach((persona, personaIndex) => {
      const yOffset =
        shownPersonas.length === 1 ? 0 : -8 + personaGap * personaIndex;
      visiblePersonaNodes.push({
        id: persona.id,
        type: "persona",
        x: personaIndex % 2 === 0 ? 74 : 88,
        y: Math.max(8, Math.min(92, groupY + yOffset)),
        label: persona.name,
        data: persona,
      });
      edges.push({ id: `${group.id}-${persona.id}`, source: group.id, target: persona.id });
    });
    return {
      id: group.id,
      type: "group" as const,
      x: 38,
      y: groupY,
      label: group.label,
      data: group,
    };
  });

  return {
    nodes: [parentNode(targetSegment), ...groupNodes, ...visiblePersonaNodes],
    edges,
    height: Math.max(700, groups.length * 150),
    minWidth: 1060,
  };
}

function createCollapsedGroupedLayout(
  personas: GeneratedPersona[],
  targetSegment: string,
): GraphLayout {
  const groups = groupPersonas(personas);
  const gap = groups.length > 1 ? 78 / (groups.length - 1) : 0;
  const groupNodes = groups.map((group, index) => ({
    id: group.id,
    type: "group" as const,
    x: 66,
    y: groups.length === 1 ? 50 : 11 + gap * index,
    label: group.label,
    data: group,
  }));
  return {
    nodes: [parentNode(targetSegment), ...groupNodes],
    edges: groupNodes.map((group) => ({
      id: `target-${group.id}`,
      source: "target",
      target: group.id,
    })),
    height: Math.max(560, groups.length * 120),
    minWidth: 820,
  };
}

function groupPersonas(personas: GeneratedPersona[]): PersonaGroup[] {
  const groups: PersonaGroup[] = [
    { id: "group-high-stress", label: "High financial stress", riskSummary: "High stress", personas: [] },
    { id: "group-accessibility", label: "Accessibility / language need", riskSummary: "Access need", personas: [] },
    { id: "group-low-trust", label: "Low trust / confidence", riskSummary: "Trust risk", personas: [] },
    { id: "group-irregular-income", label: "Irregular income", riskSummary: "Income timing", personas: [] },
    { id: "group-stable", label: "Lower-risk stable group", riskSummary: "Lower risk", personas: [] },
  ];

  personas.forEach((persona) => {
    if (persona.financialStress.toLowerCase() === "high") {
      groups[0].personas.push(persona);
    } else if (
      persona.accessibilityNeed.toLowerCase() !== "none" ||
      persona.languageNeed.toLowerCase() === "high"
    ) {
      groups[1].personas.push(persona);
    } else if (
      persona.tags.some((tag) => tag.toLowerCase() === "new-to-bank customers") ||
      persona.digitalConfidence.toLowerCase() === "low"
    ) {
      groups[2].personas.push(persona);
    } else if (
      persona.incomePattern.toLowerCase().includes("irregular") ||
      persona.incomePattern.toLowerCase().includes("variable")
    ) {
      groups[3].personas.push(persona);
    } else {
      groups[4].personas.push(persona);
    }
  });

  return groups.filter((group) => group.personas.length > 0);
}

function edgePath(source: GraphNode, target: GraphNode) {
  const startX = source.x + (source.type === "parent" ? 7 : source.type === "group" ? 5 : 0);
  const endX = target.x - (target.type === "persona" ? 5 : 5);
  const midX = startX + (endX - startX) * 0.55;
  return `M ${startX} ${source.y} C ${midX} ${source.y}, ${midX} ${target.y}, ${endX} ${target.y}`;
}

type KnowledgeNodeType =
  | "feature"
  | "targetSegment"
  | "persona"
  | "risk"
  | "attribute"
  | "recommendation"
  | "cluster";

type KnowledgeEdgeType =
  | "targets"
  | "generates"
  | "hasRisk"
  | "hasAttribute"
  | "suggests";

type RiskLevel = "Low" | "Medium" | "High";

type KnowledgeGraphNode = NodeObject & {
  id: string;
  label: string;
  type: KnowledgeNodeType;
  riskLevel?: RiskLevel;
  summary?: string;
  properties?: Record<string, string | number>;
  persona?: GeneratedPersona;
  personas?: GeneratedPersona[];
};

type KnowledgeGraphEdge = LinkObject & {
  source: string | KnowledgeGraphNode;
  target: string | KnowledgeGraphNode;
  type: KnowledgeEdgeType;
  weight?: number;
};

type KnowledgeGraphData = {
  nodes: KnowledgeGraphNode[];
  links: KnowledgeGraphEdge[];
};

const nodeTypeColors: Record<KnowledgeNodeType, string> = {
  feature: "#1774d1",
  targetSegment: "#244c86",
  persona: "#10b981",
  risk: "#f97316",
  attribute: "#14b8a6",
  recommendation: "#22c55e",
  cluster: "#64748b",
};

const graphNodeTypeConfig: Record<
  KnowledgeNodeType,
  { label: string; color: string; radius: number; clusterX: number; clusterY: number }
> = {
  feature: { label: "Feature", color: "#1774d1", radius: 14, clusterX: -360, clusterY: -80 },
  targetSegment: {
    label: "Target Segment",
    color: "#244c86",
    radius: 13,
    clusterX: -120,
    clusterY: -40,
  },
  persona: { label: "Persona", color: "#10b981", radius: 10, clusterX: 160, clusterY: 0 },
  risk: { label: "Risk Factor", color: "#f97316", radius: 9, clusterX: 460, clusterY: -150 },
  attribute: { label: "Attribute", color: "#14b8a6", radius: 7.5, clusterX: 460, clusterY: 130 },
  recommendation: {
    label: "Recommendation",
    color: "#22c55e",
    radius: 8,
    clusterX: 720,
    clusterY: 0,
  },
  cluster: { label: "Cluster", color: "#64748b", radius: 12, clusterX: 220, clusterY: 0 },
};

const edgeTypeColors: Record<KnowledgeEdgeType, string> = {
  targets: "rgba(80, 118, 156, 0.68)",
  generates: "rgba(80, 118, 156, 0.55)",
  hasRisk: "rgba(244, 63, 94, 0.58)",
  hasAttribute: "rgba(100, 116, 139, 0.42)",
  suggests: "rgba(34, 197, 94, 0.55)",
};

const graphEdgeTypeConfig: Record<KnowledgeEdgeType, { label: string; color: string }> = {
  targets: { label: "Targets", color: "rgba(80, 118, 156, 0.68)" },
  generates: { label: "Generates", color: "rgba(80, 118, 156, 0.55)" },
  hasRisk: { label: "Has risk", color: "rgba(244, 63, 94, 0.58)" },
  hasAttribute: { label: "Has attribute", color: "rgba(100, 116, 139, 0.42)" },
  suggests: { label: "Suggests", color: "rgba(34, 197, 94, 0.55)" },
};

function personaRiskLevel(persona: GeneratedPersona, result?: PersonaSimulationResult): RiskLevel {
  const score = result
    ? Math.max(
        result.stressRisk,
        result.accessibilityRisk,
        result.operationalRisk,
        result.privacyRisk,
        100 - result.clarityScore,
      )
    : persona.financialStress.toLowerCase() === "high"
      ? 74
      : persona.financialStress.toLowerCase() === "medium"
        ? 52
        : 28;
  if (score >= 70) return "High";
  if (score >= 40) return "Medium";
  return "Low";
}

function personaColor(riskLevel?: RiskLevel) {
  if (riskLevel === "High") return "#f43f5e";
  if (riskLevel === "Medium") return "#f59e0b";
  return "#10b981";
}

function getNodeColor(node: KnowledgeGraphNode) {
  if (node.type === "persona") return personaColor(node.riskLevel);
  return graphNodeTypeConfig[node.type].color;
}

function buildKnowledgeGraphData(
  form: FeatureTestInput,
  personas: GeneratedPersona[],
  simulation: SimulationResponse | null,
): KnowledgeGraphData {
  const resultByPersona = new Map(
    simulation?.personaResults.map((result) => [result.personaId, result]) ?? [],
  );
  const visiblePersonas =
    personas.length > 50 ? personas.slice(0, 0) : personas;
  const nodes: KnowledgeGraphNode[] = [
    {
      id: "feature",
      label: form.featureName || "Feature",
      type: "feature",
      summary: "Banking feature or message being reviewed before launch.",
      properties: { channel: form.channel, timing: form.shownTiming },
      fx: graphNodeTypeConfig.feature.clusterX,
      fy: graphNodeTypeConfig.feature.clusterY,
    },
    {
      id: "target-segment",
      label: form.targetCustomerSegment || "Target Segment",
      type: "targetSegment",
      summary: "Target customer group used to generate synthetic personas.",
      properties: { personas: personas.length },
      fx: graphNodeTypeConfig.targetSegment.clusterX,
      fy: graphNodeTypeConfig.targetSegment.clusterY,
    },
  ];
  const links: KnowledgeGraphEdge[] = [
    { source: "feature", target: "target-segment", type: "targets", weight: 2 },
  ];

  if (personas.length > 50) {
    groupPersonas(personas).forEach((group, index) => {
      nodes.push({
        id: `cluster-${group.id}`,
        label: group.label,
        type: "cluster",
        summary: `${group.personas.length} personas in this cluster.`,
        properties: {
          count: group.personas.length,
          risk: group.riskSummary,
        },
        personas: group.personas,
        x: graphNodeTypeConfig.cluster.clusterX,
        y: (index - 2) * 120,
      });
      links.push({
        source: "target-segment",
        target: `cluster-${group.id}`,
        type: "generates",
        weight: 1.5,
      });
    });
    return { nodes: applyKnowledgeFanoutLayout(nodes, links), links };
  }

  visiblePersonas.forEach((persona, index) => {
    const result = resultByPersona.get(persona.id);
    const riskLevel = personaRiskLevel(persona, result);
    nodes.push({
      id: persona.id,
      label: persona.name,
      type: "persona",
      riskLevel,
      summary: persona.mainConcern,
      properties: {
        segment: persona.shortLabel,
        ageRange: persona.ageRange,
        incomePattern: persona.incomePattern,
        digitalConfidence: persona.digitalConfidence,
        financialStress: persona.financialStress,
      },
      persona,
      x:
        graphNodeTypeConfig.persona.clusterX +
        ((index % 3) - 1) * 70,
      y:
        graphNodeTypeConfig.persona.clusterY +
        (index - (personas.length - 1) / 2) * (personas.length <= 12 ? 76 : 54),
    });
    links.push({
      source: "target-segment",
      target: persona.id,
      type: "generates",
      weight: riskLevel === "High" ? 2.2 : 1.4,
    });
  });

  const riskNodes = new Map<string, KnowledgeGraphNode>();
  const attrNodes = new Map<string, KnowledgeGraphNode>();
  const recommendationNodes = new Map<string, KnowledgeGraphNode>();

  visiblePersonas.forEach((persona) => {
    const result = resultByPersona.get(persona.id);
    const risks = result
      ? [
          ["Stress risk", result.stressRisk],
          ["Accessibility risk", result.accessibilityRisk],
          ["Operational risk", result.operationalRisk],
          ["Privacy risk", result.privacyRisk],
          ["Trust concern", 100 - result.trustScore],
          ["Financial wellbeing", 100 - result.financialWellbeingImpact],
        ].filter(([, score]) => Number(score) >= 40)
      : [
          ["Stress risk", persona.financialStress.toLowerCase() === "high" ? 72 : 42],
          ["Accessibility risk", persona.accessibilityNeed.toLowerCase() === "none" ? 24 : 64],
          ["Operational risk", isIrregularPersona(persona) ? 68 : 30],
        ].filter(([, score]) => Number(score) >= 40);

    risks.forEach(([risk, score]) => {
      const id = `risk-${String(risk).toLowerCase().replace(/\s+/g, "-")}`;
      if (!riskNodes.has(id)) {
        riskNodes.set(id, {
          id,
          label: String(risk),
          type: "risk",
          summary: `Affects personas with elevated ${String(risk).toLowerCase()}.`,
          properties: { affectedPersonas: 0, severity: riskLabel(Number(score)) },
          x: graphNodeTypeConfig.risk.clusterX,
          y: graphNodeTypeConfig.risk.clusterY + riskNodes.size * 72,
        });
      }
      const node = riskNodes.get(id)!;
      node.properties = {
        ...node.properties,
        affectedPersonas: Number(node.properties?.affectedPersonas ?? 0) + 1,
      };
      links.push({
        source: persona.id,
        target: id,
        type: "hasRisk",
        weight: Number(score) / 40,
      });
    });

    personaAttributes(persona).forEach((attribute) => {
      const id = `attr-${attribute.toLowerCase().replace(/\s+/g, "-").replace(/\//g, "-")}`;
      if (!attrNodes.has(id)) {
        attrNodes.set(id, {
          id,
          label: attribute,
          type: "attribute",
          summary: "Persona attribute that affects how the message may land.",
          properties: { connectedPersonas: 0 },
          x:
            graphNodeTypeConfig.attribute.clusterX +
            (attrNodes.size % 2) * 90,
          y:
            graphNodeTypeConfig.attribute.clusterY +
            Math.floor(attrNodes.size / 2) * 58,
        });
      }
      const node = attrNodes.get(id)!;
      node.properties = {
        ...node.properties,
        connectedPersonas: Number(node.properties?.connectedPersonas ?? 0) + 1,
      };
      links.push({ source: persona.id, target: id, type: "hasAttribute", weight: 0.8 });
    });

    if (result?.suggestedImprovement) {
      const id = `rec-${result.suggestedImprovement
        .toLowerCase()
        .slice(0, 36)
        .replace(/\s+/g, "-")}`;
      if (!recommendationNodes.has(id)) {
        recommendationNodes.set(id, {
          id,
          label: "Recommendation",
          type: "recommendation",
          summary: result.suggestedImprovement,
          properties: { recommendation: result.suggestedImprovement },
          x: graphNodeTypeConfig.recommendation.clusterX,
          y:
            graphNodeTypeConfig.recommendation.clusterY +
            recommendationNodes.size * 82,
        });
      }
      links.push({ source: persona.id, target: id, type: "suggests", weight: 1 });
    }
  });

  nodes.push(...riskNodes.values(), ...attrNodes.values(), ...recommendationNodes.values());
  return { nodes: applyKnowledgeFanoutLayout(nodes, links), links };
}

function applyKnowledgeFanoutLayout(
  nodes: KnowledgeGraphNode[],
  _links: KnowledgeGraphEdge[],
): KnowledgeGraphNode[] {
  const byType = (type: KnowledgeNodeType) =>
    nodes.filter((node) => node.type === type);

  const place = (node: KnowledgeGraphNode | undefined, x: number, y: number) => {
    if (!node) return;
    node.x = x;
    node.y = y;
    node.fx = x;
    node.fy = y;
  };

  const placeColumn = (
    columnNodes: KnowledgeGraphNode[],
    x: number,
    centerY: number,
    gap: number,
  ) => {
    if (!columnNodes.length) return;
    const startY = centerY - ((columnNodes.length - 1) * gap) / 2;
    columnNodes.forEach((node, index) => place(node, x, startY + index * gap));
  };

  const feature = nodes.find((node) => node.type === "feature");
  const targetSegment = nodes.find((node) => node.type === "targetSegment");
  const personas = byType("persona");
  const clusters = byType("cluster");
  const risks = byType("risk").sort((a, b) => a.label.localeCompare(b.label));
  const attributes = byType("attribute").sort((a, b) => a.label.localeCompare(b.label));
  const recommendations = byType("recommendation");

  place(feature, -640, 0);
  place(targetSegment, -410, 0);
  placeColumn(clusters, -120, 0, 128);
  placeColumn(personas, -120, 0, personas.length <= 12 ? 88 : 64);
  placeColumn(risks, 210, -220, 78);
  placeColumn(attributes, 210, 220, 62);
  placeColumn(recommendations, 560, 0, 108);

  return nodes;
}

function personaAttributes(persona: GeneratedPersona) {
  const attributes = [
    persona.incomePattern,
    `${persona.digitalConfidence} digital confidence`,
    `${persona.financialStress} financial stress`,
    `${persona.privacySensitivity} privacy sensitivity`,
  ];
  if (persona.languageNeed.toLowerCase() !== "low") {
    attributes.push(`${persona.languageNeed} language need`);
  }
  if (persona.accessibilityNeed.toLowerCase() !== "none") {
    attributes.push(persona.accessibilityNeed);
  }
  return attributes.slice(0, 5);
}

function isIrregularPersona(persona: GeneratedPersona) {
  return persona.incomePattern.toLowerCase().match(/irregular|variable|gig|casual/);
}

function formatNodeType(type: KnowledgeNodeType) {
  const labels: Record<KnowledgeNodeType, string> = {
    feature: "Feature",
    targetSegment: "Target Segment",
    persona: "Persona",
    risk: "Risk Factor",
    attribute: "Attribute",
    recommendation: "Recommendation",
    cluster: "Cluster",
  };
  return labels[type];
}

function drawKnowledgeNode(
  node: KnowledgeGraphNode,
  ctx: CanvasRenderingContext2D,
  globalScale: number,
  selected: boolean,
  hovered: boolean,
  emphasized: boolean,
) {
  const radius =
    graphNodeTypeConfig[node.type].radius * (selected ? 1.25 : hovered ? 1.15 : 1);
  const x = node.x ?? 0;
  const y = node.y ?? 0;
  ctx.globalAlpha = emphasized ? 1 : 0.28;
  ctx.beginPath();
  ctx.arc(x, y, radius + (selected ? 5 : 2), 0, 2 * Math.PI, false);
  ctx.fillStyle = selected ? "rgba(23, 116, 209, 0.18)" : "rgba(255, 255, 255, 0.8)";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, 2 * Math.PI, false);
  ctx.fillStyle = getNodeColor(node);
  ctx.fill();
  ctx.lineWidth = selected ? 2.5 : 1.4;
  ctx.strokeStyle = selected ? "#0756a6" : "rgba(255,255,255,0.92)";
  ctx.stroke();

  const showLabel =
    selected ||
    hovered ||
    node.type === "feature" ||
    node.type === "targetSegment" ||
    node.type === "persona" ||
    globalScale > 1.25;
  if (showLabel) {
    const label = node.label.length > 22 ? `${node.label.slice(0, 20)}...` : node.label;
    const fontSize = Math.max(9, 12 / globalScale);
    ctx.font = `${fontSize}px Inter, ui-sans-serif, system-ui`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const textWidth = ctx.measureText(label).width;
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    roundRect(ctx, x - textWidth / 2 - 6, y + radius + 7, textWidth + 12, fontSize + 7, 5);
    ctx.fill();
    ctx.fillStyle = "#102033";
    ctx.fillText(label, x, y + radius + 10);
  }
  ctx.globalAlpha = 1;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function GraphLegend({ graphData }: { graphData: KnowledgeGraphData }) {
  const presentTypes = new Set(graphData.nodes.map((node) => node.type));
  const presentEdgeTypes = new Set(graphData.links.map((link) => link.type));
  const items = (
    Object.entries(graphNodeTypeConfig) as Array<
      [KnowledgeNodeType, (typeof graphNodeTypeConfig)[KnowledgeNodeType]]
    >
  ).filter(([type]) => presentTypes.has(type));
  const edgeItems = (
    Object.entries(graphEdgeTypeConfig) as Array<
      [KnowledgeEdgeType, (typeof graphEdgeTypeConfig)[KnowledgeEdgeType]]
    >
  ).filter(([type]) => presentEdgeTypes.has(type));
  return (
    <div className="absolute bottom-4 left-4 z-20 rounded-lg border border-slate-200 bg-white/95 p-3 text-xs shadow-panel backdrop-blur">
      <div className="mb-2 font-bold text-slate-900">Legend</div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        {items.map(([type, config]) => (
          <div key={type} className="flex items-center gap-2 text-slate-600">
            <span
              className="h-2.5 w-2.5 rounded-full border border-white shadow-sm"
              style={{ backgroundColor: config.color }}
            />
            <span>{config.label}</span>
          </div>
        ))}
      </div>
      {edgeItems.length ? (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <div className="mb-2 font-bold text-slate-900">Edges</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            {edgeItems.map(([type, config]) => (
              <div key={type} className="flex items-center gap-2 text-slate-600">
                <span
                  className="h-0.5 w-5 rounded-full"
                  style={{ backgroundColor: config.color }}
                />
                <span>{config.label}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function toGeneratedPersona(persona: Persona): GeneratedPersona {
  return { ...persona, custom: persona.custom ?? false };
}

function fromGeneratedPersona(persona: GeneratedPersona): Persona {
  return { ...persona, custom: persona.custom ?? false };
}

function NodeDetailsPanel({
  node,
  graphData,
  onClose,
}: {
  node: KnowledgeGraphNode;
  graphData: KnowledgeGraphData;
  onClose: () => void;
}) {
  const connectedCount = graphData.links.filter((link) => {
    const source = typeof link.source === "string" ? link.source : link.source.id;
    const target = typeof link.target === "string" ? link.target : link.target.id;
    return source === node.id || target === node.id;
  }).length;
  const personaProfileFields =
    node.type === "persona" && node.persona
      ? [
          ["Age range", node.persona.ageRange],
          ["Segment", node.persona.shortLabel],
        ]
      : [];
  const personaAttributeFields =
    node.type === "persona" && node.persona
      ? [
          ["Income pattern", node.persona.incomePattern],
          ["Digital confidence", node.persona.digitalConfidence],
          ["Language need", node.persona.languageNeed],
          ["Accessibility need", node.persona.accessibilityNeed],
          ["Financial stress", node.persona.financialStress],
          ["Privacy sensitivity", node.persona.privacySensitivity],
        ]
      : [];
  const personaConcernFields =
    node.type === "persona" && node.persona
      ? [
          ["Main concern", node.persona.mainConcern],
          ["Likely misunderstanding", node.persona.likelyMisunderstanding],
        ]
      : [];
  const personaSupportFields =
    node.type === "persona" && node.persona
      ? [["Support need", node.persona.supportNeed]]
      : [];
  const propertyEntries =
    node.type !== "persona" && node.properties
      ? Object.entries(node.properties)
      : [];

  return (
    <div className="flex max-h-[620px] w-full flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-panel">
      <div className="shrink-0 border-b border-slate-200 bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-bold uppercase tracking-wide text-bnz-700">
              Node Details
            </div>
            <h3 className="mt-1 break-words text-lg font-bold leading-6 text-slate-950">
              {node.label}
            </h3>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge value={formatNodeType(node.type)} />
              {node.riskLevel ? <Badge value={`${node.riskLevel} risk`} /> : null}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close node details"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {node.summary ? (
          <p className="mt-3 rounded-lg border border-bnz-100 bg-bnz-50 p-3 text-sm leading-6 text-slate-700">
            {node.summary}
          </p>
        ) : null}
      </div>

      <div className="node-detail-scroll min-h-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden p-4">
        <section className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="mb-3 flex items-center gap-2">
            <UserRound className="h-4 w-4 text-bnz-600" />
            <h4 className="text-sm font-bold text-slate-950">Profile overview</h4>
          </div>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">
                Type
              </dt>
              <dd className="mt-1 break-words font-semibold leading-5 text-slate-800">
                {formatNodeType(node.type)}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">
                Connected nodes
              </dt>
              <dd className="mt-1 break-words font-semibold leading-5 text-slate-800">
                {connectedCount}
              </dd>
            </div>
            {personaProfileFields.map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">
                  {label}
                </dt>
                <dd className="mt-1 break-words font-semibold leading-5 text-slate-800">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        {personaAttributeFields.length || propertyEntries.length ? (
          <section className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="mb-3 flex items-center gap-2">
              <Network className="h-4 w-4 text-bnz-600" />
              <h4 className="text-sm font-bold text-slate-950">
                Financial and behavioural attributes
              </h4>
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              {personaAttributeFields.map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">
                    {label}
                  </dt>
                  <dd className="mt-1 break-words leading-5 text-slate-800">
                    {value}
                  </dd>
                </div>
              ))}
              {propertyEntries.map(([key, value]) => (
                <div key={key}>
                  <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">
                    {key.replace(/([A-Z])/g, " $1")}
                  </dt>
                  <dd className="mt-1 break-words leading-5 text-slate-800">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}

        {personaConcernFields.length ? (
          <section className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <div className="mb-3 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <h4 className="text-sm font-bold text-slate-950">
                Concerns and misunderstandings
              </h4>
            </div>
            <div className="space-y-3">
              {personaConcernFields.map(([label, value]) => (
                <div
                  key={label}
                  className="rounded-lg border border-amber-200 bg-white p-3"
                >
                  <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
                    {label}
                  </div>
                  <p className="mt-1 break-words text-sm leading-6 text-slate-800">
                    {value}
                  </p>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {personaSupportFields.length ? (
          <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
            <div className="mb-3 flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-700" />
              <h4 className="text-sm font-bold text-slate-950">
                Support needs and recommendation
              </h4>
            </div>
            <div className="space-y-3">
              {personaSupportFields.map(([label, value]) => (
                <div
                  key={label}
                  className="rounded-lg border border-emerald-200 bg-white p-3"
                >
                  <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
                    {label}
                  </div>
                  <p className="mt-1 break-words text-sm leading-6 text-slate-800">
                    {value}
                  </p>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

function PersonaTooltip({ persona }: { persona: GeneratedPersona }) {
  return (
    <div className="pointer-events-none absolute left-1/2 top-full z-[100] mt-3 hidden w-64 -translate-x-1/2 rounded-lg border border-slate-200 bg-white p-3 text-left shadow-panel group-hover:block group-focus-within:block">
      <div className="font-bold text-slate-950">{persona.name}</div>
      <div className="truncate text-sm font-medium text-bnz-700">
        {persona.shortLabel}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs text-slate-600">
        <dt className="font-semibold text-slate-500">Income</dt>
        <dd>{persona.incomePattern}</dd>
        <dt className="font-semibold text-slate-500">Stress</dt>
        <dd>{persona.financialStress}</dd>
        <dt className="font-semibold text-slate-500">Digital</dt>
        <dd>{persona.digitalConfidence}</dd>
      </dl>
    </div>
  );
}

function PersonaNetwork({
  form,
  personas,
  simulation,
  onSelect,
}: {
  form: FeatureTestInput;
  personas: GeneratedPersona[];
  simulation: SimulationResponse | null;
  onSelect: (persona: GeneratedPersona) => void;
}) {
  const graphRef = useRef<ForceGraphMethods<KnowledgeGraphNode, KnowledgeGraphEdge>>();
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedNode, setSelectedNode] = useState<KnowledgeGraphNode | null>(null);
  const [hoveredNode, setHoveredNode] = useState<KnowledgeGraphNode | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [layoutKey, setLayoutKey] = useState(0);
  const graphData = useMemo(
    () => buildKnowledgeGraphData(form, personas, simulation),
    [form, layoutKey, personas, simulation],
  );
  const connectedNodeIds = useMemo(() => {
    const current = hoveredNode ?? selectedNode;
    if (!current) return new Set<string>();
    const ids = new Set<string>([current.id]);
    graphData.links.forEach((link) => {
      const source = typeof link.source === "string" ? link.source : link.source.id;
      const target = typeof link.target === "string" ? link.target : link.target.id;
      if (source === current.id) ids.add(target);
      if (target === current.id) ids.add(source);
    });
    return ids;
  }, [graphData.links, hoveredNode, selectedNode]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    graph.d3Force("charge", null);
    graph.d3Force("link", null);
    graph.d3Force("collide", null);
    graph.d3ReheatSimulation();
  }, [graphData]);

  function fitGraph() {
    graphRef.current?.zoomToFit(500, 70);
  }

  function handleNodeClick(node: KnowledgeGraphNode) {
    setSelectedNode(node);
    if (node.type === "persona" && node.persona) {
      onSelect(node.persona);
    }
    graphRef.current?.centerAt(node.x ?? 0, node.y ?? 0, 500);
  }

  return (
    <section className="relative overflow-visible rounded-lg border border-slate-200 bg-white p-5 shadow-panel">
      <div className="mb-5 flex items-center gap-2">
        <Network className="h-5 w-5 text-bnz-600" />
        <h2 className="text-lg font-bold text-slate-950">Knowledge graph</h2>
      </div>
      <div className="relative grid items-start gap-5 overflow-visible lg:grid-cols-[1fr_280px]">
        <div
          ref={containerRef}
          className={`relative overflow-hidden rounded-lg border border-bnz-100 bg-[#f8fbff] ${
            fullscreen ? "fixed inset-4 z-[120] shadow-panel" : ""
          }`}
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle,#c8dff4_1px,transparent_1px)] [background-size:18px_18px]" />
          <div className="absolute right-4 top-4 z-20 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setLayoutKey((value) => value + 1)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
            >
              Refresh layout
            </button>
            <button
              type="button"
              onClick={fitGraph}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
            >
              Fit to view
            </button>
            <button
              type="button"
              onClick={() => setFullscreen((value) => !value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
            >
              {fullscreen ? "Exit fullscreen" : "Fullscreen"}
            </button>
          </div>

          <ForceGraph2D
            key={layoutKey}
            ref={graphRef}
            graphData={graphData}
            width={fullscreen ? window.innerWidth - 32 : 820}
            height={fullscreen ? window.innerHeight - 32 : 620}
            backgroundColor="rgba(248,251,255,0)"
            nodeRelSize={5}
            cooldownTicks={90}
            d3AlphaDecay={0.022}
            d3VelocityDecay={0.34}
            linkCurvature={0.22}
            linkDirectionalArrowLength={3}
            linkDirectionalArrowRelPos={1}
            linkWidth={(link) => {
              const source = typeof link.source === "string" ? link.source : link.source.id;
              const target = typeof link.target === "string" ? link.target : link.target.id;
              return connectedNodeIds.has(source) || connectedNodeIds.has(target) ? 2 : 1;
            }}
            linkColor={(link) => graphEdgeTypeConfig[(link as KnowledgeGraphEdge).type].color}
            nodeCanvasObject={(node, ctx, globalScale) => {
              drawKnowledgeNode(
                node as KnowledgeGraphNode,
                ctx,
                globalScale,
                selectedNode?.id === node.id,
                hoveredNode?.id === node.id,
                connectedNodeIds.size === 0 || connectedNodeIds.has(String(node.id)),
              );
            }}
            nodePointerAreaPaint={(node, color, ctx) => {
              ctx.fillStyle = color;
              ctx.beginPath();
              ctx.arc(node.x ?? 0, node.y ?? 0, 14, 0, 2 * Math.PI, false);
              ctx.fill();
            }}
            onNodeHover={(node) => setHoveredNode((node as KnowledgeGraphNode) ?? null)}
            onNodeClick={(node) => handleNodeClick(node as KnowledgeGraphNode)}
            onEngineStop={fitGraph}
          />

          {hoveredNode ? (
            <div className="pointer-events-none absolute left-4 top-4 z-20 max-w-xs rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-panel">
              <div className="font-bold text-slate-950">{hoveredNode.label}</div>
              <div className="text-xs font-semibold uppercase tracking-wide text-bnz-700">
                {formatNodeType(hoveredNode.type)}
              </div>
              {hoveredNode.summary ? (
                <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-600">
                  {hoveredNode.summary}
                </p>
              ) : null}
            </div>
          ) : null}

          <GraphLegend graphData={graphData} />
        </div>

        <div>
        {selectedNode ? (
          <NodeDetailsPanel
            node={selectedNode}
            graphData={graphData}
            onClose={() => setSelectedNode(null)}
          />
        ) : (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="text-sm leading-6 text-slate-600">
              Click a node to inspect its details.
            </div>
          </div>
        )}
        </div>
      </div>
    </section>
  );
}

function PersonaSelectionStep({
  targetCount,
  selectedPersonas,
  onTogglePersona,
  onRemovePersona,
  onAddCustomPersona,
  onContinue,
  simulating,
}: {
  targetCount: number;
  selectedPersonas: Persona[];
  onTogglePersona: (persona: Persona) => void;
  onRemovePersona: (personaId: string) => void;
  onAddCustomPersona: (persona: Persona) => void;
  onContinue: () => void;
  simulating: boolean;
}) {
  const [activeTag, setActiveTag] = useState<string>("All");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [customOpen, setCustomOpen] = useState(false);
  const [customPersona, setCustomPersona] = useState<Persona>({
    id: "",
    name: "",
    ageRange: "",
    shortLabel: "",
    tags: [],
    lifeContext: "",
    incomePattern: "",
    digitalConfidence: "",
    languageNeed: "",
    accessibilityNeed: "",
    financialStress: "",
    privacySensitivity: "",
    mainConcern: "",
    likelyMisunderstanding: "",
    supportNeed: "",
    custom: true,
  });

  const library = useMemo(() => {
    const custom = selectedPersonas.filter((persona) => persona.custom);
    const byId = new Map<string, Persona>();
    [...predefinedPersonas, ...custom].forEach((persona) => byId.set(persona.id, persona));
    return Array.from(byId.values());
  }, [selectedPersonas]);

  const filteredPersonas = activeTag === "All"
    ? library
    : library.filter((persona) => persona.tags.includes(activeTag));
  const selectedIds = new Set(selectedPersonas.map((persona) => persona.id));
  const canContinue = selectedPersonas.length === targetCount;

  function toggleExpanded(personaId: string) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(personaId)) next.delete(personaId);
      else next.add(personaId);
      return next;
    });
  }

  function updateCustom(update: Partial<Persona>) {
    setCustomPersona((current) => ({ ...current, ...update }));
  }

  function addCustom() {
    if (
      !customPersona.name.trim() ||
      !customPersona.ageRange.trim() ||
      !customPersona.shortLabel.trim() ||
      !customPersona.lifeContext.trim() ||
      !customPersona.mainConcern.trim()
    ) {
      return;
    }
    const persona: Persona = {
      ...customPersona,
      id: `custom-${customPersona.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`,
      tags: customPersona.tags.length ? customPersona.tags : ["Everyday customer"],
      custom: true,
    };
    onAddCustomPersona(persona);
    setCustomOpen(false);
    setCustomPersona({
      id: "",
      name: "",
      ageRange: "",
      shortLabel: "",
      tags: [],
      lifeContext: "",
      incomePattern: "",
      digitalConfidence: "",
      languageNeed: "",
      accessibilityNeed: "",
      financialStress: "",
      privacySensitivity: "",
      mainConcern: "",
      likelyMisunderstanding: "",
      supportNeed: "",
      custom: true,
    });
  }

  return (
    <section className="space-y-6">
      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-panel">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <UserRound className="h-5 w-5 text-bnz-600" />
              <h2 className="text-lg font-bold text-slate-950">
                Step 2: Select personas
              </h2>
            </div>
            <p className="mt-2 text-sm text-slate-600">
              Target from Step 1: {targetCount} personas
            </p>
            <p className="mt-1 text-sm font-semibold text-bnz-700">
              Selected: {selectedPersonas.length} / {targetCount}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setCustomOpen((value) => !value)}
              className="focus-ring rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50"
            >
              Add custom persona
            </button>
            <button
              type="button"
              disabled={!canContinue || simulating}
              onClick={onContinue}
              className="focus-ring inline-flex items-center gap-2 rounded-lg bg-bnz-700 px-5 py-2 text-sm font-bold text-white shadow-sm hover:bg-bnz-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {simulating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Continue to Simulation
            </button>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {["All", ...personaFilterTags].map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => setActiveTag(tag)}
              className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${
                activeTag === tag
                  ? "border-bnz-200 bg-bnz-700 text-white"
                  : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-bnz-50 hover:text-bnz-700"
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      </div>

      {customOpen ? (
        <CustomPersonaForm
          persona={customPersona}
          onChange={updateCustom}
          onAdd={addCustom}
        />
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid gap-4 md:grid-cols-2">
          {filteredPersonas.map((persona) => {
            const selected = selectedIds.has(persona.id);
            const expanded = expandedIds.has(persona.id);
            return (
              <article
                key={persona.id}
                className={`rounded-lg border bg-white p-4 shadow-panel transition ${
                  selected ? "border-bnz-300 ring-2 ring-bnz-100" : "border-slate-200"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-bold text-slate-950">{persona.name}</h3>
                    <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {persona.ageRange} · {persona.shortLabel}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onTogglePersona(persona)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                      selected
                        ? "bg-bnz-700 text-white"
                        : "border border-slate-200 bg-white text-slate-700 hover:bg-bnz-50"
                    }`}
                  >
                    {selected ? "Selected" : "Select"}
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {persona.tags.slice(0, 4).map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-600"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-600">
                  {persona.lifeContext}
                </p>
                <p className="mt-3 text-sm text-slate-700">
                  <span className="font-semibold text-slate-900">Main concern:</span>{" "}
                  {persona.mainConcern}
                </p>
                <button
                  type="button"
                  onClick={() => toggleExpanded(persona.id)}
                  className="mt-3 text-xs font-bold text-bnz-700 hover:text-bnz-900"
                >
                  {expanded ? "Hide details" : "Show details"}
                </button>
                {expanded ? (
                  <div className="mt-3 grid gap-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
                    {[
                      ["Income pattern", persona.incomePattern],
                      ["Digital confidence", persona.digitalConfidence],
                      ["Language need", persona.languageNeed],
                      ["Accessibility need", persona.accessibilityNeed],
                      ["Financial stress", persona.financialStress],
                      ["Privacy sensitivity", persona.privacySensitivity],
                      ["Likely misunderstanding", persona.likelyMisunderstanding],
                      ["Support need", persona.supportNeed],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <span className="font-bold text-slate-800">{label}:</span>{" "}
                        {value}
                      </div>
                    ))}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>

        <aside className="h-fit rounded-lg border border-slate-200 bg-white p-4 shadow-panel">
          <h3 className="font-bold text-slate-950">Selected personas</h3>
          <p className="mt-1 text-sm text-slate-600">
            {selectedPersonas.length} / {targetCount} selected
          </p>
          <div className="mt-4 space-y-2">
            {selectedPersonas.length ? (
              selectedPersonas.map((persona) => (
                <div
                  key={persona.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                >
                  <span className="text-sm font-semibold text-slate-700">
                    {persona.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => onRemovePersona(persona.id)}
                    className="rounded-md p-1 text-slate-400 hover:bg-white hover:text-rose-600"
                    title={`Remove ${persona.name}`}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-500">No personas selected yet.</p>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}

function AutoGeneratePersonaStep({
  form,
  generatedPersonas,
  selectedPersonas,
  selectedGeneratedPersona,
  result,
  generating,
  simulating,
  onGenerate,
  onSelectGeneratedPersona,
  onRemovePersona,
  onAddCustomPersona,
  onContinue,
}: {
  form: FeatureTestInput;
  generatedPersonas: GeneratedPersona[];
  selectedPersonas: Persona[];
  selectedGeneratedPersona: GeneratedPersona | null;
  result: SimulationResponse | null;
  generating: boolean;
  simulating: boolean;
  onGenerate: () => void;
  onSelectGeneratedPersona: (persona: GeneratedPersona) => void;
  onRemovePersona: (personaId: string) => void;
  onAddCustomPersona: (persona: Persona) => void;
  onContinue: () => void;
}) {
  const [customOpen, setCustomOpen] = useState(false);
  const [customPersona, setCustomPersona] = useState<Persona>({
    id: "",
    name: "",
    ageRange: "",
    shortLabel: "",
    tags: [],
    lifeContext: "",
    incomePattern: "",
    digitalConfidence: "",
    languageNeed: "",
    accessibilityNeed: "",
    financialStress: "",
    privacySensitivity: "",
    mainConcern: "",
    likelyMisunderstanding: "",
    supportNeed: "",
    custom: true,
  });
  const canContinue = selectedPersonas.length === form.personaCount;
  const selectedIds = new Set(selectedPersonas.map((persona) => persona.id));

  function updateCustom(update: Partial<Persona>) {
    setCustomPersona((current) => ({ ...current, ...update }));
  }

  function addCustom() {
    if (
      !customPersona.name.trim() ||
      !customPersona.ageRange.trim() ||
      !customPersona.shortLabel.trim() ||
      !customPersona.lifeContext.trim() ||
      !customPersona.mainConcern.trim()
    ) {
      return;
    }
    onAddCustomPersona({
      ...customPersona,
      id: `custom-${customPersona.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`,
      tags: customPersona.tags.length ? customPersona.tags : ["Everyday customer"],
      custom: true,
    });
    setCustomOpen(false);
  }

  return (
    <section className="space-y-6">
      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-panel">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-bnz-600" />
              <h2 className="text-lg font-bold text-slate-950">
                Auto-generate personas
              </h2>
            </div>
            <p className="mt-2 text-sm text-slate-600">
              Target from Step 1: {form.personaCount} personas
            </p>
            <p className="mt-1 text-sm font-semibold text-bnz-700">
              Selected: {selectedPersonas.length} / {form.personaCount}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onGenerate}
              disabled={generating || simulating}
              className="focus-ring inline-flex items-center gap-2 rounded-lg border border-bnz-200 bg-white px-4 py-2 text-sm font-bold text-bnz-700 shadow-sm hover:bg-bnz-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserRound className="h-4 w-4" />}
              {generatedPersonas.length ? "Regenerate personas" : "Generate personas"}
            </button>
            <button
              type="button"
              onClick={() => setCustomOpen((value) => !value)}
              className="focus-ring rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50"
            >
              Add custom persona
            </button>
            <button
              type="button"
              disabled={!canContinue || simulating}
              onClick={onContinue}
              className="focus-ring inline-flex items-center gap-2 rounded-lg bg-bnz-700 px-5 py-2 text-sm font-bold text-white shadow-sm hover:bg-bnz-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {simulating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Continue to Simulation
            </button>
          </div>
        </div>
      </div>

      {customOpen ? (
        <CustomPersonaForm persona={customPersona} onChange={updateCustom} onAdd={addCustom} />
      ) : null}

      {generatedPersonas.length ? (
        <PersonaNetwork
          form={form}
          personas={generatedPersonas}
          simulation={result}
          onSelect={onSelectGeneratedPersona}
        />
      ) : (
        <section className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-sm text-slate-600 shadow-panel">
          Generate personas to show the persona graph.
        </section>
      )}

      {generatedPersonas.length ? (
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-panel">
          <h3 className="font-bold text-slate-950">Generated persona cards</h3>
          <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[...generatedPersonas.map(fromGeneratedPersona), ...selectedPersonas.filter((persona) => persona.custom)].map((persona) => (
              <article
                key={persona.id}
                className={`rounded-lg border p-4 ${
                  selectedIds.has(persona.id)
                    ? "border-bnz-300 bg-bnz-50"
                    : "border-slate-200 bg-white"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h4 className="font-bold text-slate-950">{persona.name}</h4>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {persona.ageRange} · {persona.shortLabel}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRemovePersona(persona.id)}
                    className="rounded-md p-1 text-slate-400 hover:bg-white hover:text-rose-600"
                    title={`Remove ${persona.name}`}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-600">
                  {persona.lifeContext}
                </p>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </section>
  );
}

function CustomPersonaForm({
  persona,
  onChange,
  onAdd,
}: {
  persona: Persona;
  onChange: (update: Partial<Persona>) => void;
  onAdd: () => void;
}) {
  return (
    <section className="rounded-lg border border-bnz-100 bg-white p-5 shadow-panel">
      <h3 className="font-bold text-slate-950">Add custom persona</h3>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {[
          ["name", "Name"],
          ["ageRange", "Age range"],
          ["shortLabel", "Short label"],
          ["incomePattern", "Income pattern"],
          ["digitalConfidence", "Digital confidence"],
          ["languageNeed", "Language need"],
          ["accessibilityNeed", "Accessibility need"],
          ["financialStress", "Financial stress"],
          ["privacySensitivity", "Privacy sensitivity"],
        ].map(([key, label]) => (
          <Field key={key} label={label}>
            <input
              className="focus-ring w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
              value={String(persona[key as keyof Persona] ?? "")}
              onChange={(event) => onChange({ [key]: event.target.value } as Partial<Persona>)}
            />
          </Field>
        ))}
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {[
          ["lifeContext", "Life context"],
          ["mainConcern", "Main concern"],
          ["likelyMisunderstanding", "Likely misunderstanding"],
          ["supportNeed", "Support need"],
        ].map(([key, label]) => (
          <Field key={key} label={label}>
            <textarea
              className="focus-ring min-h-20 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm leading-6"
              value={String(persona[key as keyof Persona] ?? "")}
              onChange={(event) => onChange({ [key]: event.target.value } as Partial<Persona>)}
            />
          </Field>
        ))}
      </div>
      <div className="mt-4">
        <div className="text-sm font-semibold text-slate-700">Tags</div>
        <div className="mt-3 flex flex-wrap gap-2">
          {personaFilterTags.map((tag) => {
            const checked = persona.tags.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                onClick={() =>
                  onChange({
                    tags: checked
                      ? persona.tags.filter((item) => item !== tag)
                      : [...persona.tags, tag],
                  })
                }
                className={`rounded-full border px-3 py-1.5 text-xs font-bold ${
                  checked
                    ? "border-bnz-200 bg-bnz-700 text-white"
                    : "border-slate-200 bg-slate-50 text-slate-600"
                }`}
              >
                {tag}
              </button>
            );
          })}
        </div>
      </div>
      <button
        type="button"
        onClick={onAdd}
        className="focus-ring mt-5 rounded-lg bg-bnz-700 px-4 py-2 text-sm font-bold text-white hover:bg-bnz-900"
      >
        Add persona
      </button>
    </section>
  );
}

function PersonaResultCard({ result }: { result: PersonaSimulationResult }) {
  const ruleBasedChecks = result.ruleBasedChecks ?? [];

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-slate-950">{result.personaName}</h3>
          <p className="text-sm font-medium text-bnz-700">{result.segment}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge value={`Stress ${riskLabel(result.stressRisk)}`} />
          <Badge value={`Access ${riskLabel(result.accessibilityRisk)}`} />
        </div>
      </div>
      <p className="mt-4 text-sm leading-6 text-slate-700">
        {result.likelyReaction}
      </p>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
            Main issues
          </div>
          <ul className="mt-2 space-y-2 text-sm text-slate-700">
            {result.mainIssues.map((issue) => (
              <li key={issue} className="flex gap-2">
                <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-bnz-500" />
                <span>{issue}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
            Rule-based checks
          </div>
          {ruleBasedChecks.length ? (
            <ul className="mt-2 space-y-2 text-sm text-slate-700">
              {ruleBasedChecks.map((rule) => (
                <li key={rule.ruleId} className="rounded-lg bg-slate-50 p-3">
                  <div className="font-semibold text-slate-900">{rule.description}</div>
                  <div className="mt-1 text-xs text-slate-500">{rule.impact}</div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-slate-500">No deterministic checks triggered.</p>
          )}
        </div>
      </div>
      <div className="mt-4 rounded-lg border border-bnz-100 bg-bnz-50 p-4">
        <div className="text-xs font-bold uppercase tracking-wide text-bnz-700">
          Suggested improvement
        </div>
        <p className="mt-1 text-sm leading-6 text-slate-800">
          {result.suggestedImprovement}
        </p>
      </div>
      <div className="mt-4 flex flex-wrap gap-3 text-sm text-slate-600">
        <span>Clarity: {result.clarityScore}/100</span>
        <span>Trust: {result.trustScore}/100</span>
        <span>Privacy risk: {result.privacyRisk}/100</span>
        <span>Operational risk: {result.operationalRisk}/100</span>
      </div>
    </div>
  );
}

function Results({ result }: { result: SimulationResponse }) {
  const debug = result.developmentDebug;
  const isFallback = !result.used_openai || Boolean(result.fallback_reason);

  return (
    <section className="space-y-6">
      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-panel">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-bnz-700">
              <Sparkles className="h-4 w-4" />
              Simulation result
            </div>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">
              {result.overallSummary}
            </p>
            {isFallback ? (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
                <div className="font-bold">Fallback result</div>
                <div className="mt-1">
                  {result.fallback_reason || "Fallback was used, but no reason was provided."}
                </div>
                {debug?.requestId ? (
                  <div className="mt-1 text-xs font-semibold">
                    requestId: {debug.requestId}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
          <Badge value={isFallback ? "Fallback result" : "AI review + checks"} />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <ScoreCard label="Launch decision" value={result.overallDecision} />
        <ScoreCard label="Clarity score" value={`${result.clarityScore}/100`} />
        <ScoreCard
          label="Customer trust score"
          value={`${result.customerTrustScore}/100`}
        />
        <ScoreCard
          label="Financial wellbeing"
          value={result.financialWellbeingImpact}
        />
        <ScoreCard label="Fairness risk" value={`${result.fairnessRisk}/100`} />
        <ScoreCard
          label="Accessibility risk"
          value={`${result.accessibilityRisk}/100`}
        />
        <ScoreCard label="Privacy risk" value={`${result.privacyRisk}/100`} />
        <ScoreCard
          label="Operational risk"
          value={`${result.operationalRisk}/100`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-panel">
          <div className="mb-4 flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-bnz-600" />
            <h2 className="text-lg font-bold text-slate-950">Top risks</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {result.topRisks.map((risk) => (
              <Badge key={risk} value={risk} />
            ))}
          </div>
          <div className="mt-4 text-sm text-slate-600">
            Most affected: {result.topAffectedPersonas.join(", ")}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-panel">
          <h2 className="text-lg font-bold text-slate-950">Better message</h2>
          <p className="mt-3 rounded-lg border border-bnz-100 bg-bnz-50 p-4 text-sm leading-6 text-slate-800">
            {result.betterMessage}
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-panel">
        <h2 className="text-lg font-bold text-slate-950">Top recommendations</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {result.topRecommendations.map((recommendation) => (
            <div
              key={recommendation}
              className="rounded-lg border border-bnz-100 bg-bnz-50 p-4 text-sm leading-6 text-slate-700"
            >
              {recommendation}
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-panel">
        <h2 className="text-lg font-bold text-slate-950">Rule-based checks</h2>
        {(result.ruleBasedChecks ?? []).length ? (
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {(result.ruleBasedChecks ?? []).map((rule) => (
              <div key={rule.ruleId} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="text-sm font-semibold text-slate-900">
                  {rule.description}
                </div>
                <div className="mt-1 text-xs font-medium text-slate-500">
                  {rule.impact}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-slate-500">
            No global deterministic checks were triggered.
          </p>
        )}
        {result.scoreDiffs && Object.keys(result.scoreDiffs).length ? (
          <p className="mt-4 text-xs font-medium text-slate-500">
            Final score cards include rule-based adjustments.
          </p>
        ) : null}
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        {result.personaResults.map((personaResult) => (
          <PersonaResultCard key={personaResult.personaId} result={personaResult} />
        ))}
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-panel">
        <div className="border-b border-slate-200 p-5">
          <h2 className="text-lg font-bold text-slate-950">Risk table</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3">Persona</th>
                <th className="px-5 py-3">Main risk</th>
                <th className="px-5 py-3">Risk level</th>
                <th className="px-5 py-3">Why it matters</th>
                <th className="px-5 py-3">Recommended change</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {result.personaResults.map((item) => {
                const mainRisk = mainPersonaRisk(item);
                return (
                  <tr key={item.personaId}>
                    <td className="px-5 py-4 font-semibold text-slate-900">
                      {item.personaName}
                    </td>
                    <td className="px-5 py-4 font-medium text-slate-800">
                      {mainRisk.label}
                    </td>
                    <td className="px-5 py-4">
                      <Badge value={`${riskLabel(mainRisk.score)} (${mainRisk.score}/100)`} />
                    </td>
                    <td className="max-w-sm px-5 py-4 text-slate-600">
                      {primaryWhy(item)}
                    </td>
                    <td className="max-w-sm px-5 py-4 text-slate-600">
                      {item.suggestedImprovement}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {result.uiScreenshotAnalysis ? (
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-panel">
          <div className="mb-4 flex items-center gap-2">
            <ImageUp className="h-5 w-5 text-bnz-600" />
            <h2 className="text-lg font-bold text-slate-950">
              UI Screenshot Analysis
            </h2>
          </div>
          <p className="text-sm leading-6 text-slate-700">
            {result.uiScreenshotAnalysis.what_ai_saw}
          </p>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {[
              ["UI clarity issues", result.uiScreenshotAnalysis.ui_clarity_issues],
              ["Button/action issues", result.uiScreenshotAnalysis.button_action_issues],
              ["Accessibility issues", result.uiScreenshotAnalysis.accessibility_issues],
              [
                "Recommended UI improvements",
                result.uiScreenshotAnalysis.recommended_ui_improvements,
              ],
            ].map(([title, items]) => (
              <div key={title as string} className="rounded-lg bg-slate-50 p-4">
                <h3 className="font-semibold text-slate-900">{title as string}</h3>
                <ul className="mt-2 space-y-2 text-sm text-slate-600">
                  {(items as string[]).map((item) => (
                    <li key={item} className="flex gap-2">
                      <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-bnz-500" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      ) : null}

    </section>
  );
}

const defaultAdvisorPrompts = [
  "What are the top 3 launch risks?",
  "Rewrite the message to reduce stress.",
  "Which persona is most likely to misunderstand this?",
  "Create a short A/B test plan.",
];

function advisorCampaignInput(form: FeatureTestInput): AdvisorCampaignInput {
  return {
    featureName: form.featureName,
    featureDescription: form.featureDescription,
    customerFacingCopy: form.customerFacingCopy,
    targetCustomerSegment: form.targetCustomerSegment,
    channel: form.channel,
    shownTiming: form.shownTiming,
    expectedCustomerAction: form.expectedCustomerAction,
    dataUsedShared: form.dataUsedShared,
    riskFocus: form.riskFocus,
    personaCount: form.personaCount,
    screenshotUploaded: Boolean(form.screenshot),
    screenshotName: form.screenshot?.name ?? null,
  };
}

function advisorSimulationResult(result: SimulationResponse): SimulationResponse {
  const {
    rawOpenAIResult: _rawOpenAIResult,
    developmentDebug: _developmentDebug,
    openaiResponseId: _openaiResponseId,
    openaiAttempts: _openaiAttempts,
    openaiAttemptResponseIds: _openaiAttemptResponseIds,
    ...safeResult
  } = result;
  return safeResult;
}

function SimulationAdvisorChat({
  form,
  personas,
  result,
}: {
  form: FeatureTestInput;
  personas: GeneratedPersona[];
  result: SimulationResponse;
}) {
  const [messages, setMessages] = useState<AdvisorChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [suggestedPrompts, setSuggestedPrompts] = useState(defaultAdvisorPrompts);
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const resultKey = result.requestId ?? result.developmentDebug?.requestId ?? result.overallSummary;

  useEffect(() => {
    setMessages([]);
    setInput("");
    setChatError(null);
    setSuggestedPrompts(defaultAdvisorPrompts);
  }, [resultKey]);

  async function sendMessage(content: string) {
    const question = content.trim();
    if (!question || sending) return;

    const nextMessages: AdvisorChatMessage[] = [
      ...messages,
      { role: "user" as const, content: question },
    ].slice(-12);

    setMessages(nextMessages);
    setInput("");
    setSending(true);
    setChatError(null);

    try {
      const response = await askSimulationAdvisor({
        campaignInput: advisorCampaignInput(form),
        personas,
        simulationResult: advisorSimulationResult(result),
        messages: nextMessages,
      });
      setMessages((current) => [
        ...current,
        { role: "assistant" as const, content: response.answer },
      ].slice(-12));
      if (response.suggestedPrompts.length) {
        setSuggestedPrompts(response.suggestedPrompts);
      }
      if (!response.used_openai && response.fallback_reason) {
        setChatError(`Advisor fallback: ${response.fallback_reason}`);
      }
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "Advisor chat failed");
      setMessages(messages);
    } finally {
      setSending(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(input);
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-panel">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-bnz-700">
            <BrainCircuit className="h-4 w-4" />
            Simulation advisor
          </div>
          <h2 className="mt-2 text-lg font-bold text-slate-950">
            Ask about this simulation
          </h2>
        </div>
        <Badge value="Context-bound chat" />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {suggestedPrompts.map((prompt) => (
          <button
            key={prompt}
            type="button"
            disabled={sending}
            onClick={() => void sendMessage(prompt)}
            className="rounded-lg border border-bnz-100 bg-bnz-50 px-3 py-1.5 text-xs font-bold text-bnz-700 hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {prompt}
          </button>
        ))}
      </div>

      <div className="mt-5 max-h-96 space-y-3 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-4">
        {messages.length ? (
          messages.map((message, index) => (
            <div
              key={`${message.role}-${index}`}
              className={
                message.role === "user"
                  ? "ml-auto max-w-3xl rounded-lg border border-bnz-100 bg-white p-3 text-sm leading-6 text-slate-800"
                  : "mr-auto max-w-3xl rounded-lg border border-emerald-100 bg-emerald-50 p-3 text-sm leading-6 text-slate-800"
              }
            >
              <div className="mb-1 text-xs font-bold uppercase text-slate-500">
                {message.role === "user" ? "You" : "Advisor"}
              </div>
              <div className="whitespace-pre-wrap">{message.content}</div>
            </div>
          ))
        ) : (
          <p className="text-sm leading-6 text-slate-600">
            Ask a targeted question about the current simulation result, personas,
            risks, copy, or launch readiness.
          </p>
        )}
        {sending ? (
          <div className="mr-auto max-w-3xl rounded-lg border border-emerald-100 bg-emerald-50 p-3 text-sm font-semibold text-slate-700">
            Thinking...
          </div>
        ) : null}
      </div>

      {chatError ? (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
          {chatError}
        </div>
      ) : null}

      <form className="mt-4 flex flex-col gap-3 sm:flex-row" onSubmit={onSubmit}>
        <input
          className="min-w-0 flex-1 rounded-lg border px-3 py-2.5 text-sm"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Ask what to fix first, request a rewrite, or compare personas..."
          disabled={sending}
        />
        <button
          className="focus-ring inline-flex items-center justify-center gap-2 rounded-lg bg-bnz-700 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-bnz-900 disabled:cursor-not-allowed disabled:opacity-60"
          type="submit"
          disabled={sending || !input.trim()}
        >
          <ArrowRight className="h-4 w-4" />
          Send
        </button>
      </form>
    </section>
  );
}

export default function App() {
  const [form, setForm] = useState<FeatureTestInput>(defaultForm);
  const [personas, setPersonas] = useState<GeneratedPersona[]>([]);
  const [selectedPersonas, setSelectedPersonas] = useState<Persona[]>([]);
  const [selectedPersona, setSelectedPersona] = useState<GeneratedPersona | null>(null);
  const [result, setResult] = useState<SimulationResponse | null>(null);
  const [personaSetupMode, setPersonaSetupMode] = useState<PersonaSetupMode>("auto");
  const [activeTab, setActiveTab] = useState<ActiveTab>("input");
  const [inputsChanged, setInputsChanged] = useState(false);
  const [analyzingAd, setAnalyzingAd] = useState(false);
  const [generatingAudienceFit, setGeneratingAudienceFit] = useState(false);
  const [audienceFit, setAudienceFit] = useState<AudienceFitResponse | null>(null);
  const [serverAdAnalysis, setServerAdAnalysis] = useState<AdAnalysisPreview | null>(null);
  const [generating, setGenerating] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latestSimulationRequestRef = useRef(0);

  const selectedFileName = useMemo(
    () => form.screenshot?.name ?? "Upload screenshot",
    [form.screenshot],
  );
  const heuristicAdAnalysis = useMemo(() => buildAdAnalysisPreview(form), [form]);
  const adAnalysis = serverAdAnalysis ?? heuristicAdAnalysis;

  function updateForm(update: Partial<FeatureTestInput>) {
    setForm((current) => ({ ...current, ...update }));
    setServerAdAnalysis(null);
    setAudienceFit(null);
    if (selectedPersonas.length || personas.length) {
      setInputsChanged(true);
    }
  }

  function validateForm() {
    if (!form.featureName.trim()) return "Campaign name is required";
    if (!form.customerFacingCopy.trim()) {
      return "Advertisement copy or campaign brief is required";
    }
    if (!form.targetCustomerSegment.trim()) {
      return "Audience hypothesis is required";
    }
    if (!form.expectedCustomerAction.trim()) {
      return "Expected customer action is required";
    }
    if (form.personaCount < 1 || form.personaCount > 100) {
      return "Persona count must be between 1 and 100";
    }
    return null;
  }

  async function onAnalyzeAd() {
    if (!form.featureName.trim()) {
      setError("Campaign name is required before ad analysis");
      return;
    }
    if (!form.customerFacingCopy.trim()) {
      setError("Advertisement copy or campaign brief is required before ad analysis");
      return;
    }
    setAnalyzingAd(true);
    setError(null);
    try {
      const response = await analyzeAd({
        campaignName: form.featureName,
        advertisementCopy: form.customerFacingCopy,
        channel: form.channel,
        placement: form.shownTiming,
        campaignContext: form.featureDescription,
      });
      const preview = fromAdAnalysisResponse(response);
      setServerAdAnalysis(preview);
      setAudienceFit(null);
      setForm((current) => ({
        ...current,
        targetCustomerSegment: preview.hypothesis,
        expectedCustomerAction: preview.expectedAction,
        featureDescription: current.featureDescription.trim()
          ? current.featureDescription
          : [
              `Product type: ${preview.productType}.`,
              `Offer angle: ${preview.offerAngle}.`,
              `Likely intent: ${preview.likelyIntent}.`,
              `Behavior signals: ${preview.behaviorSignals.join(", ")}.`,
            ].join(" "),
      }));
    } catch (err) {
      const preview = buildAdAnalysisPreview(form);
      setServerAdAnalysis({ ...preview, usedOpenAI: false, fallbackReason: String(err) });
      setForm((current) => ({
        ...current,
        targetCustomerSegment: current.targetCustomerSegment.trim()
          ? current.targetCustomerSegment
          : preview.hypothesis,
        expectedCustomerAction: current.expectedCustomerAction.trim()
          ? current.expectedCustomerAction
          : preview.expectedAction,
        featureDescription: current.featureDescription.trim()
          ? current.featureDescription
          : [
              `Product type: ${preview.productType}.`,
              `Offer angle: ${preview.offerAngle}.`,
              `Likely intent: ${preview.likelyIntent}.`,
              `Behavior signals: ${preview.behaviorSignals.join(", ")}.`,
            ].join(" "),
      }));
      setError(
        err instanceof Error
          ? `${err.message}. Showing local fallback analysis.`
          : "Ad analysis failed. Showing local fallback analysis.",
      );
    } finally {
      setAnalyzingAd(false);
    }
  }

  async function onGenerateAudienceFit() {
    if (!form.featureName.trim()) {
      setError("Campaign name is required before segment fit generation");
      return;
    }
    if (!form.customerFacingCopy.trim()) {
      setError("Advertisement copy or campaign brief is required before segment fit generation");
      return;
    }
    const hypothesis = form.targetCustomerSegment.trim() || adAnalysis.hypothesis;
    if (!hypothesis.trim()) {
      setError("Audience hypothesis is required before segment fit generation");
      return;
    }
    setGeneratingAudienceFit(true);
    setError(null);
    try {
      const response = await generateAudienceFit({
        campaignName: form.featureName,
        advertisementCopy: form.customerFacingCopy,
        channel: form.channel,
        placement: form.shownTiming,
        campaignContext: form.featureDescription,
        audienceHypothesis: hypothesis,
        audienceCues: adAnalysis.audienceCues,
        behaviorSignals: adAnalysis.behaviorSignals,
        profileCount: form.personaCount,
      });
      setAudienceFit(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Audience fit failed");
    } finally {
      setGeneratingAudienceFit(false);
    }
  }

  function onContinueToPersonaSetup() {
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    setResult(null);
    setInputsChanged(false);
    setActiveTab("graph");
  }

  async function onGenerateAutoPersonas() {
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }
    setGenerating(true);
    setError(null);
    setResult(null);
    try {
      const response = await generatePersonas(form);
      const generated = response.personas.slice(0, form.personaCount);
      setPersonas(generated);
      setSelectedPersona(generated[0] ?? null);
      setSelectedPersonas(generated.map(fromGeneratedPersona));
      setInputsChanged(false);
      if (!response.used_openai || response.fallback_reason) {
        console.info("Persona generation fallback details", {
          usedOpenAI: response.used_openai,
          fallbackReason: response.fallback_reason,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Persona generation failed");
    } finally {
      setGenerating(false);
    }
  }

  async function onRunSimulation() {
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }
    if (selectedPersonas.length !== form.personaCount) {
      setError(`Select exactly ${form.personaCount} personas before continuing.`);
      return;
    }
    const simulationPersonas = selectedPersonas.map(toGeneratedPersona);
    const requestSequence = latestSimulationRequestRef.current + 1;
    latestSimulationRequestRef.current = requestSequence;
    setPersonas(simulationPersonas);
    setSelectedPersona(simulationPersonas[0] ?? null);
    setSimulating(true);
    setError(null);
    try {
      const simulation = await runSimulation(form, simulationPersonas);
      console.log("/api/run-simulation response", simulation);
      if (requestSequence !== latestSimulationRequestRef.current) {
        console.info("Ignoring stale simulation response", {
          requestSequence,
          latestRequestSequence: latestSimulationRequestRef.current,
          requestId: simulation.developmentDebug?.requestId,
        });
        return;
      }
      if (!simulation.used_openai || simulation.fallback_reason) {
        console.info("Simulation fallback details", {
          requestId: simulation.developmentDebug?.requestId,
          usedOpenAI: simulation.used_openai,
          fallbackReason: simulation.fallback_reason,
          imageUploaded: simulation.developmentDebug?.imageUploaded,
          personaCount: simulation.developmentDebug?.personaCount,
          personaNames: simulation.developmentDebug?.personaNames,
        });
      }
      setResult(simulation);
      setActiveTab("results");
    } catch (err) {
      if (requestSequence !== latestSimulationRequestRef.current) {
        return;
      }
      setError(err instanceof Error ? err.message : "Simulation failed");
    } finally {
      if (requestSequence === latestSimulationRequestRef.current) {
        setSimulating(false);
      }
    }
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-5 py-8 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-bnz-100 bg-bnz-50 px-3 py-1 text-sm font-semibold text-bnz-700">
              <BrainCircuit className="h-4 w-4" />
              Banking innovation dashboard
            </div>
            <h1 className="text-3xl font-bold text-slate-950 md:text-4xl">
              Synthetic Customer Lab
            </h1>
            <p className="mt-3 max-w-3xl text-base leading-7 text-slate-600">
              Test banking messages and UI screens with AI-generated customer
              segments before launch.
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            Early pre-launch risk check, not a replacement for real user testing.
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-5 py-6">
        <nav className="mb-6 flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
          {[
            ["input", "Input", true],
            ["graph", "Select personas", true],
            ["results", "Simulation result", result !== null],
          ].map(([tab, label, available]) => (
            <button
              key={tab as string}
              type="button"
              disabled={!available}
              onClick={() => setActiveTab(tab as ActiveTab)}
              className={`rounded-lg px-4 py-2 text-sm font-bold transition ${
                activeTab === tab
                  ? "bg-bnz-700 text-white shadow-sm"
                  : available
                    ? "text-slate-600 hover:bg-bnz-50 hover:text-bnz-700"
                    : "cursor-not-allowed text-slate-300"
              }`}
            >
              {label as string}
            </button>
          ))}
        </nav>

        {error ? (
          <div className="mb-6 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        {inputsChanged && personas.length ? (
          <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-700">
            Inputs changed. Review persona selection before continuing.
          </div>
        ) : null}

        {activeTab === "input" ? (
          <div className="w-full max-w-5xl">
          <form
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault();
              onContinueToPersonaSetup();
            }}
            className="rounded-lg border border-slate-200 bg-white p-5 shadow-panel"
          >
            <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-bnz-600" />
                <h2 className="text-lg font-bold text-slate-950">
                  Step 1: Analyze advertisement
                </h2>
              </div>
              <span className="text-sm font-medium text-slate-500">
                Ad input to audience hypothesis to persona setup
              </span>
            </div>
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
              <section className="space-y-4">
              <Field label="Campaign name">
                <input
                  className="focus-ring w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
                  placeholder="Platinum travel rewards card"
                  value={form.featureName}
                  onChange={(event) => updateForm({ featureName: event.target.value })}
                />
              </Field>
              <Field label="Advertisement copy or campaign brief">
                <textarea
                  className="focus-ring min-h-44 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm leading-6"
                  placeholder="Earn 3x points on flights, hotels, and dining with a platinum credit card built for frequent travellers."
                  value={form.customerFacingCopy}
                  onChange={(event) =>
                    updateForm({ customerFacingCopy: event.target.value })
                  }
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Channel">
                  <select
                    className="focus-ring w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
                    value={form.channel}
                    onChange={(event) => updateForm({ channel: event.target.value })}
                  >
                    {channels.map((channel) => (
                      <option key={channel}>{channel}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Synthetic profile count">
                  <input
                    type="number"
                    min={1}
                    max={100}
                    className="focus-ring w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
                    value={form.personaCount}
                    onChange={(event) =>
                      updateForm({ personaCount: Number(event.target.value) })
                    }
                  />
                </Field>
              </div>
              <Field label="Placement / trigger point">
                <input
                  className="focus-ring w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
                  placeholder="Mobile app offer tile, email campaign, search landing page, or post-login banner."
                  value={form.shownTiming}
                  onChange={(event) => updateForm({ shownTiming: event.target.value })}
                />
              </Field>
              <Field label="Optional campaign context">
                <textarea
                  className="focus-ring min-h-24 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm leading-6"
                  placeholder="Add product constraints, eligibility, market, brand tone, or anything not visible in the ad copy."
                  value={form.featureDescription}
                  onChange={(event) =>
                    updateForm({ featureDescription: event.target.value })
                  }
                />
              </Field>
              <button
                type="button"
                disabled={analyzingAd}
                onClick={() => void onAnalyzeAd()}
                className="focus-ring inline-flex w-full items-center justify-center gap-2 rounded-lg bg-bnz-700 px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-bnz-900 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {analyzingAd ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <BrainCircuit className="h-4 w-4" />
                )}
                {analyzingAd ? "Analyzing with OpenAI" : "Analyze ad"}
              </button>
              </section>

              <aside className="space-y-4">
                <section className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-bold text-slate-950">
                        Ad analysis
                      </h3>
                      <p className="mt-1 text-xs leading-5 text-slate-500">
                        Preview of the audience assumptions used in the next step.
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <Badge value={adAnalysis.likelyIntent} />
                      <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs font-semibold text-slate-500">
                        {adAnalysis.usedOpenAI
                          ? "OpenAI"
                          : adAnalysis.fallbackReason
                            ? "Local fallback"
                            : "Local preview"}
                      </span>
                    </div>
                  </div>
                  <div className="grid gap-3">
                    {[
                      ["Product type", adAnalysis.productType],
                      ["Offer angle", adAnalysis.offerAngle],
                      ["Likely intent", adAnalysis.likelyIntent],
                    ].map(([label, value]) => (
                      <div
                        key={label}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-2"
                      >
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                          {label}
                        </div>
                        <div className="mt-1 text-sm font-semibold text-slate-800">
                          {value}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                    <div>
                      <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
                        Audience cues
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {adAnalysis.audienceCues.map((cue) => (
                          <span
                            key={cue}
                            className="rounded-full border border-bnz-100 bg-white px-2.5 py-1 text-xs font-semibold text-bnz-700"
                          >
                            {cue}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
                        Behavior signals
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {adAnalysis.behaviorSignals.map((signal) => (
                          <span
                            key={signal}
                            className="rounded-full border border-emerald-100 bg-white px-2.5 py-1 text-xs font-semibold text-emerald-700"
                          >
                            {signal}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </section>

                <section className="rounded-lg border border-slate-200 bg-white p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h3 className="text-sm font-bold text-slate-950">
                        Estimated segment fit
                      </h3>
                      <p className="mt-1 text-xs leading-5 text-slate-500">
                        Generates synthetic banking feature profiles, then calls the segmentation service.
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={generatingAudienceFit || analyzingAd}
                      onClick={() => void onGenerateAudienceFit()}
                      className="focus-ring inline-flex items-center justify-center gap-2 rounded-lg border border-bnz-200 bg-bnz-50 px-3 py-2 text-xs font-bold text-bnz-700 transition hover:bg-bnz-100 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {generatingAudienceFit ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Network className="h-4 w-4" />
                      )}
                      {generatingAudienceFit ? "Generating" : "Generate fit"}
                    </button>
                  </div>

                  {audienceFit ? (
                    <div className="mt-4 space-y-3">
                      <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
                        <span>Primary segment: {audienceFit.primarySegment ?? "None"}</span>
                        <span>{audienceFit.profileCount} profiles</span>
                      </div>
                      {audienceFit.segments.map((segment) => (
                        <div key={segment.segment_name}>
                          <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                            <span className="font-semibold text-slate-700">
                              {segment.segment_name}
                            </span>
                            <span className="font-bold text-slate-900">
                              {segment.percentage.toFixed(1)}%
                            </span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                            <div
                              className="h-full rounded-full bg-bnz-700"
                              style={{ width: `${Math.min(100, segment.percentage)}%` }}
                            />
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            {segment.count} profiles, average confidence{" "}
                            {segment.average_confidence.toFixed(2)}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-4 rounded-lg border border-dashed border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-500">
                      Generate fit after the ad analysis looks right. Percentages appear after synthetic profiles are classified by the segmentation service.
                    </div>
                  )}
                </section>

                <Field label="Editable audience hypothesis">
                <textarea
                  className="focus-ring min-h-28 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm leading-6"
                  placeholder={adAnalysis.hypothesis}
                  value={form.targetCustomerSegment}
                  onChange={(event) =>
                    updateForm({ targetCustomerSegment: event.target.value })
                  }
                />
              </Field>
              <Field label="Expected customer action">
                <textarea
                  className="focus-ring min-h-24 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm leading-6"
                  placeholder={adAnalysis.expectedAction}
                  value={form.expectedCustomerAction}
                  onChange={(event) =>
                    updateForm({ expectedCustomerAction: event.target.value })
                  }
                />
              </Field>
              <Field label="Data, eligibility, or privacy notes">
                <textarea
                  className="focus-ring min-h-20 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm leading-6"
                  placeholder="Add any stated eligibility criteria, consent language, targeting limits, or product restrictions."
                  value={form.dataUsedShared}
                  onChange={(event) =>
                    updateForm({ dataUsedShared: event.target.value })
                  }
                />
              </Field>
                <section className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                    <div>
                      <div className="text-sm font-bold text-amber-800">
                        Ambiguity to resolve
                      </div>
                      <ul className="mt-2 space-y-1 text-xs leading-5 text-amber-700">
                        {adAnalysis.ambiguity.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </section>
              </aside>

              <section className="lg:col-span-2">
                <div className="text-sm font-semibold text-slate-700">Risk focus for later simulation</div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {riskFocusOptions.map((risk) => {
                    const checked = form.riskFocus.includes(risk);
                    return (
                      <label
                        key={risk}
                        className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${
                          checked
                            ? "border-bnz-200 bg-bnz-50 text-bnz-900"
                            : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) => {
                            const next = event.target.checked
                              ? [...form.riskFocus, risk]
                              : form.riskFocus.filter((item) => item !== risk);
                            updateForm({ riskFocus: next });
                          }}
                          className="h-4 w-4 rounded border-slate-300 text-bnz-700 focus:ring-bnz-500"
                        />
                        <span>{risk}</span>
                      </label>
                    );
                  })}
                </div>
              </section>
              <section className="lg:col-span-2">
              <Field label="Optional ad or landing page screenshot">
                <label className="focus-ring flex cursor-pointer flex-col gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-sm text-slate-600">
                  <span className="flex min-w-0 items-center gap-2">
                    <ImageUp className="h-4 w-4 shrink-0 text-bnz-600" />
                    <span className="truncate">{selectedFileName}</span>
                  </span>
                  <span className="text-xs leading-5 text-slate-500">
                    Upload a creative, customer-facing screen, prototype, notification, or landing page screenshot.
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={(event) =>
                      updateForm({ screenshot: event.target.files?.[0] ?? null })
                    }
                  />
                </label>
              </Field>
              </section>
              <div className="flex flex-col gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:items-center sm:justify-between lg:col-span-2">
              <p className="text-sm leading-6 text-slate-500">
                Next step uses this hypothesis to generate synthetic personas, then the segmentation service can classify the generated profiles.
              </p>
              <button
                type="button"
                disabled={simulating}
                onClick={onContinueToPersonaSetup}
                className="focus-ring inline-flex items-center justify-center gap-2 rounded-lg border border-bnz-200 bg-white px-4 py-3 text-sm font-bold text-bnz-700 shadow-sm transition hover:bg-bnz-50 disabled:cursor-not-allowed disabled:opacity-70"
              >
                <UserRound className="h-4 w-4" />
                Continue to synthetic audience
                <ArrowRight className="h-4 w-4" />
              </button>
              </div>
            </div>
          </form>
          </div>
        ) : null}

        {activeTab === "graph" ? (
          <div className="space-y-6">
            <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
              <div className="grid gap-2 sm:grid-cols-2">
                {[
                  ["auto", "Auto-generate personas"],
                  ["manual", "Select manually"],
                ].map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => {
                      const nextMode = mode as PersonaSetupMode;
                      if (nextMode !== personaSetupMode) {
                        setSelectedPersonas([]);
                        setPersonas([]);
                        setSelectedPersona(null);
                        setResult(null);
                      }
                      setPersonaSetupMode(nextMode);
                      setError(null);
                    }}
                    className={`rounded-lg px-4 py-3 text-sm font-bold transition ${
                      personaSetupMode === mode
                        ? "bg-bnz-700 text-white shadow-sm"
                        : "bg-slate-50 text-slate-600 hover:bg-bnz-50 hover:text-bnz-700"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </section>

            {personaSetupMode === "auto" ? (
              <AutoGeneratePersonaStep
                form={form}
                generatedPersonas={personas}
                selectedPersonas={selectedPersonas}
                selectedGeneratedPersona={selectedPersona}
                result={result}
                generating={generating}
                simulating={simulating}
                onGenerate={() => void onGenerateAutoPersonas()}
                onSelectGeneratedPersona={setSelectedPersona}
                onRemovePersona={(personaId) => {
                  setPersonas((current) =>
                    current.filter((item) => item.id !== personaId),
                  );
                  setSelectedPersonas((current) =>
                    current.filter((item) => item.id !== personaId),
                  );
                }}
                onAddCustomPersona={(persona) => {
                  if (selectedPersonas.length >= form.personaCount) {
                    setError("You have already selected the planned number of personas.");
                    return;
                  }
                  setError(null);
                  setSelectedPersonas((current) => [...current, persona]);
                }}
                onContinue={() => void onRunSimulation()}
              />
            ) : (
              <PersonaSelectionStep
                targetCount={form.personaCount}
                selectedPersonas={selectedPersonas}
                onTogglePersona={(persona) => {
                  const exists = selectedPersonas.some((item) => item.id === persona.id);
                  if (exists) {
                    setSelectedPersonas((current) =>
                      current.filter((item) => item.id !== persona.id),
                    );
                    return;
                  }
                  if (selectedPersonas.length >= form.personaCount) {
                    setError("You have already selected the planned number of personas.");
                    return;
                  }
                  setError(null);
                  setSelectedPersonas((current) => [...current, persona]);
                }}
                onRemovePersona={(personaId) => {
                  setSelectedPersonas((current) =>
                    current.filter((item) => item.id !== personaId),
                  );
                }}
                onAddCustomPersona={(persona) => {
                  if (selectedPersonas.length >= form.personaCount) {
                    setError("You have already selected the planned number of personas.");
                    return;
                  }
                  setError(null);
                  setSelectedPersonas((current) => [...current, persona]);
                }}
                onContinue={() => void onRunSimulation()}
                simulating={simulating}
              />
            )}
          </div>
        ) : null}

        {activeTab === "results" ? (
          <div className="space-y-6">
            {!result ? (
              <section className="rounded-lg border border-slate-200 bg-white p-8 shadow-panel">
                <div className="flex max-w-3xl flex-col gap-4">
                  <CheckCircle2 className="h-10 w-10 text-bnz-600" />
                  <h2 className="text-2xl font-bold text-slate-950">
                    Run simulation first.
                  </h2>
                  <p className="text-sm leading-6 text-slate-600">
                    Select personas, then run the simulation to generate risk findings.
                  </p>
                  <button
                    type="button"
                    onClick={() => setActiveTab("graph")}
                    className="focus-ring inline-flex w-fit items-center justify-center rounded-lg bg-bnz-700 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-bnz-900"
                  >
                    Back to Select personas
                  </button>
                </div>
              </section>
            ) : (
              <>
                <div className="flex items-center justify-between gap-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-700">
                  <span>Step 3: Review risks - Simulation complete.</span>
                  <button
                    type="button"
                    disabled={simulating || selectedPersonas.length !== form.personaCount}
                    onClick={() => void onRunSimulation()}
                    className="rounded-lg border border-emerald-200 bg-white px-3 py-1.5 text-xs font-bold text-emerald-700 shadow-sm hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Run simulation again
                  </button>
                </div>
                <Results result={result} />
                <SimulationAdvisorChat
                  form={form}
                  personas={personas}
                  result={result}
                />
              </>
            )}
          </div>
        ) : null}
      </div>
    </main>
  );
}
