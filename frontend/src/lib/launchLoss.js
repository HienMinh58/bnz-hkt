export const MIN_REVISION_IMPROVEMENT = 0.03;
export const TARGET_LAUNCH_LOSS = 0.25;
export const MAX_REVISION_ROUNDS = 3;

export function toLossScore(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  return Math.round(value * 100);
}

export function formatLossScore(value) {
  const score = toLossScore(value);
  return score === null ? "N/A" : `${score}/100`;
}

export function formatLossPointDelta(value) {
  const points = toLossScore(Math.abs(value));
  if (points === null) return "N/A";
  return `${points} ${points === 1 ? "point" : "points"}`;
}

export function formatLossPointCompound(value) {
  const points = toLossScore(Math.abs(value));
  if (points === null) return "N/A";
  return `${points}-point`;
}

export function formatRiskScore(label, value) {
  return `${label} risk ${formatLossScore(value)}`;
}

export function lossLevel(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return "Unknown";
  if (value < 0.25) return "Low";
  if (value < 0.45) return "Medium";
  return "High";
}

export function summarizeIndependentBatchScores(batches) {
  const scores = batches
    .map((batch) => toLossScore(batch.launchLoss))
    .filter((score) => typeof score === "number");
  if (!scores.length) {
    return {
      completedCount: 0,
      averageScore: null,
      minScore: null,
      maxScore: null,
      rangeLabel: "Range: N/A",
      averageLabel: "Average: N/A",
      consistencyLabel: "No completed persona groups yet.",
    };
  }

  const minScore = Math.min(...scores);
  const maxScore = Math.max(...scores);
  const averageScore = Math.round(
    scores.reduce((total, score) => total + score, 0) / scores.length,
  );
  const levels = new Set(
    batches
      .filter((batch) => typeof batch.launchLoss === "number")
      .map((batch) => lossLevel(batch.launchLoss)),
  );
  const onlyLevel = levels.size === 1 ? [...levels][0] : null;

  return {
    completedCount: scores.length,
    averageScore,
    minScore,
    maxScore,
    rangeLabel: `Range: ${minScore}-${maxScore}/100 across ${scores.length} persona groups`,
    averageLabel: `Average: ${averageScore}/100 across completed persona groups`,
    consistencyLabel: onlyLevel
      ? `Risk remained consistently ${onlyLevel} across persona batches.`
      : "Risk varied across persona batches.",
  };
}

export function decisionRank(decision) {
  if (decision === "Do not launch") return 2;
  if (decision === "Revise before release") return 1;
  return 0;
}

function financialWellbeingRank(value) {
  if (value === "Negative") return 2;
  if (value === "Neutral") return 1;
  return 0;
}

export function criticalRiskWorsening(current, candidate) {
  const failures = [];
  if (candidate.privacyRisk > current.privacyRisk) failures.push("privacy");
  if (candidate.fairnessRisk > current.fairnessRisk) failures.push("fairness");
  if (candidate.accessibilityRisk > current.accessibilityRisk) {
    failures.push("accessibility");
  }
  if (
    financialWellbeingRank(candidate.financialWellbeingImpact) >
    financialWellbeingRank(current.financialWellbeingImpact)
  ) {
    failures.push("financial wellbeing");
  }
  return failures;
}

export function hasSamePersonaIds(personas, result) {
  const expectedIds = personas.map((persona) => persona.id);
  const actualIds = (result.personaResults ?? []).map((persona) => persona.personaId);
  if (expectedIds.length !== actualIds.length) return false;
  return expectedIds.every((id, index) => id === actualIds[index]);
}

export function evaluateRevisionAcceptance({
  current,
  candidate,
  minImprovement = MIN_REVISION_IMPROVEMENT,
  fixedPersonaSet,
}) {
  const currentLoss = current.launchLoss;
  const candidateLoss = candidate.launchLoss;
  const improvement =
    typeof currentLoss === "number" && typeof candidateLoss === "number"
      ? currentLoss - candidateLoss
      : 0;
  const guardrailFailures = criticalRiskWorsening(current, candidate);
  const decisionWorsened =
    decisionRank(candidate.overallDecision) > decisionRank(current.overallDecision);

  if (!fixedPersonaSet) {
    return {
      accepted: false,
      improvement,
      reason: "Candidate rejected - persona set changed during evaluation.",
      guardrailFailures: ["persona set"],
    };
  }
  if (improvement < minImprovement) {
    return {
      accepted: false,
      improvement,
      reason: `Candidate rejected - ${formatLossPointCompound(improvement)} improvement`,
      guardrailFailures: [],
    };
  }
  if (decisionWorsened) {
    return {
      accepted: false,
      improvement,
      reason: "Candidate rejected - launch decision worsened.",
      guardrailFailures: ["launch decision"],
    };
  }
  if (guardrailFailures.length) {
    return {
      accepted: false,
      improvement,
      reason: `Candidate rejected - ${guardrailFailures.join(", ")} guardrail worsened.`,
      guardrailFailures,
    };
  }
  return {
    accepted: true,
    improvement,
    reason: `Improved by ${formatLossPointDelta(improvement)} from the original message.`,
    guardrailFailures: [],
  };
}
