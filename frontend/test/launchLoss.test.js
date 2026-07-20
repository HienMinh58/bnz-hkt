import assert from "node:assert/strict";
import test from "node:test";

import {
  MIN_REVISION_IMPROVEMENT,
  evaluateRevisionAcceptance,
  formatLossPointDelta,
  formatLossScore,
  formatRiskScore,
  summarizeIndependentBatchScores,
} from "../src/lib/launchLoss.js";

const baseResult = {
  launchLoss: 0.49,
  overallDecision: "Revise before release",
  privacyRisk: 30,
  fairnessRisk: 20,
  accessibilityRisk: 25,
  financialWellbeingImpact: "Neutral",
};

test("formats launch loss as a directional score out of 100", () => {
  assert.equal(formatLossScore(0.49), "49/100");
  assert.equal(formatRiskScore("Privacy", 0.64), "Privacy risk 64/100");
  assert.equal(formatLossPointDelta(0.03), "3 points");
});

test("summarizes independent persona batch scores without improvement wording", () => {
  const summary = summarizeIndependentBatchScores([
    { batchIndex: 1, launchLoss: 0.46 },
    { batchIndex: 2, launchLoss: 0.52 },
    { batchIndex: 3, launchLoss: 0.49 },
    { batchIndex: 4, launchLoss: 0.51 },
  ]);

  assert.equal(summary.completedCount, 4);
  assert.equal(summary.rangeLabel, "Range: 46-52/100 across 4 persona groups");
  assert.equal(summary.averageLabel, "Average: 50/100 across completed persona groups");
  assert.equal(
    summary.consistencyLabel,
    "Risk remained consistently High across persona batches.",
  );
});

test("rejects candidates below the minimum improvement rule", () => {
  const result = evaluateRevisionAcceptance({
    current: baseResult,
    candidate: { ...baseResult, launchLoss: 0.49 },
    minImprovement: MIN_REVISION_IMPROVEMENT,
    fixedPersonaSet: true,
  });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, "Candidate rejected - 0-point improvement");
});

test("accepts candidates that improve enough with the fixed persona set", () => {
  const result = evaluateRevisionAcceptance({
    current: baseResult,
    candidate: { ...baseResult, launchLoss: 0.43 },
    minImprovement: MIN_REVISION_IMPROVEMENT,
    fixedPersonaSet: true,
  });

  assert.equal(result.accepted, true);
  assert.equal(result.improvement, 0.06);
});

test("rejects candidates when a critical risk guardrail worsens", () => {
  const result = evaluateRevisionAcceptance({
    current: baseResult,
    candidate: {
      ...baseResult,
      launchLoss: 0.43,
      privacyRisk: 31,
    },
    minImprovement: MIN_REVISION_IMPROVEMENT,
    fixedPersonaSet: true,
  });

  assert.equal(result.accepted, false);
  assert.deepEqual(result.guardrailFailures, ["privacy"]);
});

test("rejects candidates that were not evaluated on the fixed persona set", () => {
  const result = evaluateRevisionAcceptance({
    current: baseResult,
    candidate: { ...baseResult, launchLoss: 0.43 },
    minImprovement: MIN_REVISION_IMPROVEMENT,
    fixedPersonaSet: false,
  });

  assert.equal(result.accepted, false);
  assert.deepEqual(result.guardrailFailures, ["persona set"]);
});
