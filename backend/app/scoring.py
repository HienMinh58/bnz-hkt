import re
from statistics import mean

from app.models import (
    GeneratedPersona,
    PersonaSimulationResult,
    SimulationResultResponse,
    TriggeredRule,
    UIScreenshotAnalysis,
)


ABSTRACT_PHRASES = [
    "non-essential spending",
    "consider",
    "may go into overdraft",
    "may",
    "where possible",
]
ACTION_WORDS = ["transfer", "review", "contact", "call", "delay", "move", "pay"]
SUPPORT_PHRASES = ["contact us", "support", "talk to us", "help"]
SENSITIVE_TERMS = ["overdraft", "low balance", "payment", "bill", "account"]


def clamp(value: int) -> int:
    return max(0, min(100, value))


def has_any(text: str, phrases: list[str]) -> bool:
    lower = text.lower()
    return any(phrase in lower for phrase in phrases)


def has_specific_amount(message: str) -> bool:
    return bool(re.search(r"\$\s?\d+", message))


def is_irregular_income(persona: GeneratedPersona) -> bool:
    value = persona.incomePattern.lower()
    return any(term in value for term in ["irregular", "variable", "gig", "casual"])


def needs_assisted_support(persona: GeneratedPersona) -> bool:
    combined = (
        f"{persona.accessibilityNeed} {persona.languageNeed} "
        f"{persona.lifeContext} {persona.supportNeed}"
    ).lower()
    return any(
        term in combined
        for term in ["assist", "screen reader", "larger text", "plain language", "step-by-step"]
    )


def has_shared_context(persona: GeneratedPersona) -> bool:
    combined = (
        f"{persona.shortLabel} {' '.join(persona.tags)} "
        f"{persona.mainConcern} {persona.lifeContext}"
    ).lower()
    return any(term in combined for term in ["shared", "household", "partner", "family"])


def global_message_rules(message: str, send_timing: str) -> list[TriggeredRule]:
    lower = message.lower()
    rules: list[TriggeredRule] = []
    if "non-essential spending" in lower:
        rules.append(
            TriggeredRule(
                ruleId="global_abstract_phrase_non_essential_spending",
                description="Global message rule: abstract phrase 'non-essential spending'.",
                impact="+accessibility risk, -clarity score",
            )
        )
    if "may go into overdraft" in lower or "consider" in lower:
        rules.append(
            TriggeredRule(
                ruleId="global_soft_overdraft_wording",
                description="Global message rule: soft warning wording may reduce clarity.",
                impact="-clarity score, +accessibility risk",
            )
        )
    if has_specific_amount(message):
        rules.append(
            TriggeredRule(
                ruleId="global_specific_amount",
                description="Global message rule: specific dollar amount improves action clarity.",
                impact="+clarity score",
            )
        )
    if has_any(message, ACTION_WORDS):
        rules.append(
            TriggeredRule(
                ruleId="global_clear_next_action",
                description="Global message rule: message includes concrete next actions.",
                impact="+clarity score, +financial wellbeing",
            )
        )
    if "2 days before expected overdraft" in send_timing.lower():
        rules.append(
            TriggeredRule(
                ruleId="global_two_day_warning",
                description="Global message rule: two-day warning gives time to act.",
                impact="+financial wellbeing, -operational risk",
            )
        )
    return rules


def persona_specific_rules(
    persona: GeneratedPersona,
    message: str,
    channel: str,
) -> list[TriggeredRule]:
    lower = message.lower()
    rules: list[TriggeredRule] = []
    if is_irregular_income(persona) and ("overdraft" in lower or "balance" in lower):
        rules.append(
            TriggeredRule(
                ruleId="persona_irregular_income_prediction_risk",
                description=(
                    "Persona-specific rule: irregular income can make prediction-based "
                    "balance warnings feel incomplete."
                ),
                impact="+operational risk, +stress risk, -trust score",
            )
        )
    if persona.financialStress.lower() == "high" and "overdraft" in lower:
        rules.append(
            TriggeredRule(
                ruleId="persona_high_financial_stress",
                description="Persona-specific rule: high financial stress increases pressure from overdraft warnings.",
                impact="+stress risk",
            )
        )
    if needs_assisted_support(persona) and not has_any(message, SUPPORT_PHRASES):
        rules.append(
            TriggeredRule(
                ruleId="persona_assisted_support_gap",
                description="Persona-specific rule: assisted or accessibility support need is not matched by a support option.",
                impact="+accessibility risk, +stress risk",
            )
        )
    if (
        channel.lower() == "mobile app notification"
        and has_any(message, SENSITIVE_TERMS)
        and (has_shared_context(persona) or persona.privacySensitivity.lower() == "high")
    ):
        rules.append(
            TriggeredRule(
                ruleId="persona_mobile_preview_privacy_risk",
                description="Persona-specific rule: sensitive financial details may appear in a mobile notification preview.",
                impact="+privacy risk, +trust risk",
            )
        )
    if "new-to-bank customers" in [tag.lower() for tag in persona.tags]:
        rules.append(
            TriggeredRule(
                ruleId="persona_low_trust_needs_explanation",
                description="Persona-specific rule: lower trust means the warning needs a clear reason and source.",
                impact="-trust score",
            )
        )
    return rules


def score_persona(
    persona: GeneratedPersona,
    message: str,
    channel: str,
    send_timing: str,
) -> PersonaSimulationResult:
    clarity = 72
    trust = 72
    stress = 34
    fairness = 25
    accessibility = 30
    privacy = 18
    wellbeing = 58
    operational = 28
    issues: list[str] = []
    recommendations: list[str] = []
    rules = [*global_message_rules(message, send_timing), *persona_specific_rules(persona, message, channel)]

    # Baseline differences make the same message land differently by profile.
    if persona.financialStress.lower() == "high":
        stress += 14
        wellbeing -= 5
    elif persona.financialStress.lower() == "low":
        stress -= 6
        wellbeing += 4

    if persona.digitalConfidence.lower() == "low":
        accessibility += 10
        clarity -= 4
    elif persona.digitalConfidence.lower() == "high":
        accessibility -= 4

    if persona.languageNeed.lower() == "high":
        accessibility += 16
        clarity -= 8
    elif persona.languageNeed.lower() == "medium":
        accessibility += 8
        clarity -= 3

    if "financial vulnerability" in [tag.lower() for tag in persona.tags]:
        stress += 9
        wellbeing -= 4
    elif persona.financialStress.lower() == "low":
        stress -= 5

    if is_irregular_income(persona):
        operational += 16
        trust -= 7
    else:
        operational -= 5

    if has_shared_context(persona):
        privacy += 16

    for rule in rules:
        if rule.ruleId == "global_abstract_phrase_non_essential_spending":
            clarity -= 10
            accessibility += 13
            issues.append("The phrase 'non-essential spending' is open to interpretation.")
        elif rule.ruleId == "global_soft_overdraft_wording":
            clarity -= 7
            accessibility += 5
            issues.append("The warning should be more direct about what may happen.")
        elif rule.ruleId == "global_specific_amount":
            clarity += 9
            issues.append("The $ amount makes the action more concrete.")
        elif rule.ruleId == "global_clear_next_action":
            clarity += 9
            wellbeing += 7
        elif rule.ruleId == "global_two_day_warning":
            wellbeing += 8
            operational -= 4
        elif rule.ruleId == "persona_irregular_income_prediction_risk":
            operational += 14
            stress += 7
            trust -= 8
            issues.append("Prediction accuracy matters because income may arrive irregularly.")
            recommendations.append("Explain whether expected incoming payments are included.")
        elif rule.ruleId == "persona_high_financial_stress":
            stress += 15
            issues.append("The overdraft wording may increase pressure for this persona.")
            recommendations.append("Use supportive wording and avoid blame.")
        elif rule.ruleId == "persona_assisted_support_gap":
            accessibility += 18
            stress += 6
            issues.append("The message should include a clear support pathway.")
            recommendations.append("Add a visible contact or support option.")
        elif rule.ruleId == "persona_mobile_preview_privacy_risk":
            privacy += 34
            trust -= 6
            issues.append("A lock-screen notification could reveal sensitive account information.")
            recommendations.append("Use a discreet notification preview and show details after login.")
        elif rule.ruleId == "persona_low_trust_needs_explanation":
            trust -= 10
            issues.append("The message should explain why the bank is sending this alert.")

    if not issues:
        issues.append("The alert is likely understandable, but it still needs a clear action path.")
    if not recommendations:
        recommendations.append("Keep the action wording specific and easy to complete.")

    return PersonaSimulationResult(
        personaId=persona.id,
        personaName=persona.name,
        segment=persona.shortLabel,
        likelyReaction=build_reaction_copy(persona, message),
        clarityScore=clamp(clarity),
        trustScore=clamp(trust),
        stressRisk=clamp(stress),
        fairnessRisk=clamp(fairness),
        accessibilityRisk=clamp(accessibility),
        privacyRisk=clamp(privacy),
        financialWellbeingImpact=clamp(wellbeing),
        operationalRisk=clamp(operational),
        mainIssues=dedupe(issues)[:4],
        triggeredRules=rules,
        suggestedImprovement=dedupe(recommendations)[0],
        betterMessage=build_better_message(message),
    )


def build_reaction_copy(persona: GeneratedPersona, message: str) -> str:
    concern = persona.mainConcern.rstrip(".")
    income = persona.incomePattern.lower()
    if "overdraft" in message.lower():
        return (
            f"{persona.name} may find the alert useful because it gives early warning, "
            f"but they would need confidence that {concern.lower()}. Because their income "
            f"pattern is {income}, the message should explain the prediction and offer a "
            f"clear next step."
        )
    return (
        f"{persona.name} may understand the message, but they would need it to connect "
        f"clearly to their situation: {concern.lower()}. The wording should stay practical "
        f"and make the next action obvious."
    )


def build_better_message(message: str) -> str:
    if "overdraft" in message.lower():
        return (
            "Your balance may not cover your upcoming payments by Friday. You could "
            "move $120 from savings now, review upcoming bills, or contact us if you "
            "need support."
        )
    return (
        "Here is what may change, why it matters, and the next step you can take. "
        "Contact us if you need support."
    )


def build_mock_simulation(
    personas: list[GeneratedPersona],
    feature_name: str,
    message: str,
    target_customers: str,
    channel: str,
    send_timing: str,
    image_uploaded: bool,
    fallback_reason: str | None = None,
) -> SimulationResultResponse:
    if not personas:
        return empty_simulation(feature_name, target_customers, fallback_reason)

    results = [
        score_persona(persona, message, channel, send_timing) for persona in personas
    ]
    clarity = safe_mean([result.clarityScore for result in results], 0)
    trust = safe_mean([result.trustScore for result in results], 0)
    stress = safe_mean([result.stressRisk for result in results], 0)
    fairness = safe_mean([result.fairnessRisk for result in results], 0)
    accessibility = safe_mean([result.accessibilityRisk for result in results], 0)
    privacy = safe_mean([result.privacyRisk for result in results], 0)
    wellbeing = safe_mean([result.financialWellbeingImpact for result in results], 0)
    operational = safe_mean([result.operationalRisk for result in results], 0)

    if clarity < 45 or trust < 45 or stress >= 82 or operational >= 82 or privacy >= 85:
        decision = "Do not launch"
    elif (
        clarity < 72
        or stress >= 55
        or accessibility >= 55
        or operational >= 48
        or privacy >= 55
    ):
        decision = "Revise before release"
    else:
        decision = "Launch"

    top_risks = _top_risks(
        {
            "stress risk": stress,
            "accessibility risk": accessibility,
            "operational risk": operational,
            "privacy risk": privacy,
            "fairness risk": fairness,
        }
    )
    top_affected = [
        result.personaName
        for result in sorted(
            results,
            key=lambda item: (
                item.stressRisk
                + item.accessibilityRisk
                + item.operationalRisk
                + item.privacyRisk
                + (100 - item.clarityScore)
            ),
            reverse=True,
        )[:3]
    ]

    ui_analysis = None
    if image_uploaded:
        ui_analysis = UIScreenshotAnalysis(
            what_ai_saw=(
                "A screenshot was uploaded. Visual screenshot analysis requires the AI image review path."
            ),
            ui_clarity_issues=["Visible UI text should be checked for plain language and hierarchy."],
            button_action_issues=["Primary action should clearly match the recommended next step."],
            accessibility_issues=["Check contrast, reading order, and tap target size before launch."],
            recommended_ui_improvements=[
                "Keep sensitive account details behind authentication where possible."
            ],
        )

    return SimulationResultResponse(
        overallDecision=decision,
        overallSummary=(
            f"{feature_name} was reviewed against {len(personas)} synthetic personas "
            f"generated from '{target_customers.rstrip('.')}'. The highest pre-launch "
            f"concerns are {', '.join(top_risks).lower()}. This is an early synthetic "
            f"risk review, not a replacement for real customer research."
        ),
        clarityScore=clarity,
        customerTrustScore=trust,
        financialWellbeingImpact=(
            "Positive" if wellbeing >= 70 else "Negative" if wellbeing < 45 else "Neutral"
        ),
        fairnessRisk=fairness,
        accessibilityRisk=accessibility,
        privacyRisk=privacy,
        operationalRisk=operational,
        topRisks=top_risks,
        topAffectedPersonas=top_affected,
        topRecommendations=top_recommendations(privacy, message),
        betterMessage=build_better_message(message),
        personaResults=results,
        uiScreenshotAnalysis=ui_analysis,
        used_openai=False,
        fallback_reason=fallback_reason,
    )


def empty_simulation(
    feature_name: str,
    target_customers: str,
    fallback_reason: str | None,
) -> SimulationResultResponse:
    return SimulationResultResponse(
        overallDecision="Revise before release",
        overallSummary=(
            f"{feature_name} could not be reviewed because no personas were available "
            f"for '{target_customers.rstrip('.')}'. Generate personas before running the simulation."
        ),
        clarityScore=0,
        customerTrustScore=0,
        financialWellbeingImpact="Neutral",
        fairnessRisk=0,
        accessibilityRisk=0,
        privacyRisk=0,
        operationalRisk=0,
        topRisks=[],
        topAffectedPersonas=[],
        topRecommendations=[
            "Generate at least one persona before running the simulation.",
            "Check that the target customer field is specific enough.",
            "Run the review again after personas are available.",
        ],
        betterMessage=build_better_message(""),
        personaResults=[],
        uiScreenshotAnalysis=None,
        used_openai=False,
        fallback_reason=fallback_reason,
    )


def merge_ai_and_rules(
    ai_result: SimulationResultResponse,
    personas: list[GeneratedPersona],
    message: str,
    target_customers: str,
    feature_name: str,
    channel: str,
    send_timing: str,
    image_uploaded: bool,
) -> SimulationResultResponse:
    raw_ai_result = ai_result.model_dump(
        exclude={
            "ruleBasedChecks",
            "aiScores",
            "ruleScores",
            "finalScores",
            "adjustedScores",
            "scoreDiffs",
            "rawOpenAIResult",
        }
    )
    rule_result = build_mock_simulation(
        personas=personas,
        feature_name=feature_name,
        message=message,
        target_customers=target_customers,
        channel=channel,
        send_timing=send_timing,
        image_uploaded=image_uploaded,
        fallback_reason=None,
    )
    rule_by_id = {item.personaId: item for item in rule_result.personaResults}
    merged_results: list[PersonaSimulationResult] = []

    for item in ai_result.personaResults:
        rule_item = rule_by_id.get(item.personaId)
        if rule_item is None:
            ai_scores = persona_score_set(item)
            merged_results.append(
                item.model_copy(
                    update={
                        "aiScores": ai_scores,
                        "finalScores": ai_scores,
                        "triggeredRules": item.triggeredRules,
                    }
                )
            )
            continue
        ai_scores = persona_score_set(item)
        rule_scores = persona_score_set(rule_item)
        final_scores = {
            "clarityScore": round((item.clarityScore + rule_item.clarityScore) / 2),
            "trustScore": round((item.trustScore + rule_item.trustScore) / 2),
            "stressRisk": max(item.stressRisk, rule_item.stressRisk),
            "fairnessRisk": max(item.fairnessRisk, rule_item.fairnessRisk),
            "accessibilityRisk": max(item.accessibilityRisk, rule_item.accessibilityRisk),
            "privacyRisk": max(item.privacyRisk, rule_item.privacyRisk),
            "financialWellbeingImpact": round(
                (item.financialWellbeingImpact + rule_item.financialWellbeingImpact) / 2
            ),
            "operationalRisk": max(item.operationalRisk, rule_item.operationalRisk),
        }
        diffs = score_diffs(ai_scores, final_scores)
        merged_results.append(
            item.model_copy(
                update={
                    **final_scores,
                    "likelyReaction": item.likelyReaction or rule_item.likelyReaction,
                    "triggeredRules": item.triggeredRules,
                    "ruleBasedChecks": rule_item.triggeredRules,
                    "mainIssues": item.mainIssues or rule_item.mainIssues,
                    "suggestedImprovement": (
                        item.suggestedImprovement or rule_item.suggestedImprovement
                    ),
                    "betterMessage": item.betterMessage or rule_item.betterMessage,
                    "aiScores": ai_scores,
                    "ruleScores": rule_scores,
                    "finalScores": final_scores,
                    "adjustedScores": final_scores if diffs else None,
                    "scoreDiffs": diffs or None,
                }
            )
        )

    if not merged_results:
        return empty_simulation(feature_name, target_customers, None)

    clarity = safe_mean([item.clarityScore for item in merged_results], 0)
    trust = safe_mean([item.trustScore for item in merged_results], 0)
    stress = safe_mean([item.stressRisk for item in merged_results], 0)
    fairness = safe_mean([item.fairnessRisk for item in merged_results], 0)
    accessibility = safe_mean([item.accessibilityRisk for item in merged_results], 0)
    privacy = safe_mean([item.privacyRisk for item in merged_results], 0)
    operational = safe_mean([item.operationalRisk for item in merged_results], 0)
    wellbeing = safe_mean([item.financialWellbeingImpact for item in merged_results], 0)
    ai_scores = overall_score_set(ai_result)
    rule_scores = overall_score_set(rule_result)
    final_scores = {
        "clarityScore": clarity,
        "customerTrustScore": trust,
        "fairnessRisk": fairness,
        "accessibilityRisk": accessibility,
        "privacyRisk": privacy,
        "operationalRisk": operational,
    }
    diffs = score_diffs(ai_scores, final_scores)

    decision = ai_result.overallDecision
    if clarity < 45 or trust < 45 or stress >= 82 or operational >= 82 or privacy >= 85:
        decision = "Do not launch"
    elif (
        clarity < 72
        or stress >= 55
        or accessibility >= 55
        or operational >= 48
        or privacy >= 55
    ):
        decision = "Revise before release"

    return ai_result.model_copy(
        update={
            "overallDecision": decision,
            "overallSummary": ai_result.overallSummary or rule_result.overallSummary,
            "clarityScore": clarity,
            "customerTrustScore": trust,
            "financialWellbeingImpact": (
                "Positive" if wellbeing >= 70 else "Negative" if wellbeing < 45 else "Neutral"
            ),
            "fairnessRisk": fairness,
            "accessibilityRisk": accessibility,
            "privacyRisk": privacy,
            "operationalRisk": operational,
            "topRisks": ai_result.topRisks or rule_result.topRisks,
            "topAffectedPersonas": [
                result.personaName
                for result in sorted(
                    merged_results,
                    key=lambda item: (
                        item.stressRisk
                        + item.accessibilityRisk
                        + item.operationalRisk
                        + item.privacyRisk
                        + (100 - item.clarityScore)
                    ),
                    reverse=True,
                )[:3]
            ],
            "topRecommendations": ai_result.topRecommendations or rule_result.topRecommendations,
            "betterMessage": ai_result.betterMessage or rule_result.betterMessage,
            "personaResults": merged_results,
            "uiScreenshotAnalysis": ai_result.uiScreenshotAnalysis,
            "ruleBasedChecks": global_message_rules(message, send_timing),
            "aiScores": ai_scores,
            "ruleScores": rule_scores,
            "finalScores": final_scores,
            "adjustedScores": final_scores if diffs else None,
            "scoreDiffs": diffs or None,
            "rawOpenAIResult": raw_ai_result,
            "used_openai": True,
            "fallback_reason": None,
        }
    )


def persona_score_set(result: PersonaSimulationResult) -> dict[str, int]:
    return {
        "clarityScore": result.clarityScore,
        "trustScore": result.trustScore,
        "stressRisk": result.stressRisk,
        "fairnessRisk": result.fairnessRisk,
        "accessibilityRisk": result.accessibilityRisk,
        "privacyRisk": result.privacyRisk,
        "financialWellbeingImpact": result.financialWellbeingImpact,
        "operationalRisk": result.operationalRisk,
    }


def overall_score_set(result: SimulationResultResponse) -> dict[str, int]:
    return {
        "clarityScore": result.clarityScore,
        "customerTrustScore": result.customerTrustScore,
        "fairnessRisk": result.fairnessRisk,
        "accessibilityRisk": result.accessibilityRisk,
        "privacyRisk": result.privacyRisk,
        "operationalRisk": result.operationalRisk,
    }


def score_diffs(ai_scores: dict[str, int], final_scores: dict[str, int]) -> dict[str, int]:
    return {
        key: final_scores[key] - ai_scores[key]
        for key in final_scores
        if key in ai_scores and final_scores[key] != ai_scores[key]
    }


def safe_mean(values: list[int], default: int) -> int:
    return round(mean(values)) if values else default


def dedupe(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if value not in seen:
            seen.add(value)
            result.append(value)
    return result


def top_recommendations(privacy: int, message: str = "") -> list[str]:
    is_overdraft_review = "overdraft" in message.lower()
    recommendations = [
        "Replace abstract wording with plain, specific actions.",
        (
            "Explain prediction limits for customers with irregular income."
            if is_overdraft_review
            else "Make consent, timing, and customer control clear before confirmation."
        ),
        "Add a visible support option to reduce stress and improve trust.",
    ]
    if privacy >= 45:
        recommendations[2] = (
            "Use a discreet notification preview such as 'You have an account alert' "
            "and show details only after login."
        )
    return recommendations


def _top_risks(risks: dict[str, int]) -> list[str]:
    return [
        f"{name.title()} ({score}/100)"
        for name, score in sorted(risks.items(), key=lambda item: item[1], reverse=True)[
            :3
        ]
    ]
