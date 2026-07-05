from app.models import GeneratedPersona


AGE_RANGES = ["18-24", "25-34", "35-44", "45-54", "55-64", "65-74", "75+"]

TEMPLATES = [
    {
        "name": "Mia",
        "shortLabel": "Gig worker",
        "tags": ["Irregular income", "Financial vulnerability", "Operational risk"],
        "incomePattern": "Irregular app-based income with uneven weekly deposits",
        "digitalConfidence": "High",
        "languageNeed": "Low",
        "accessibilityNeed": "None",
        "financialStress": "High",
        "privacySensitivity": "Medium",
        "mainConcern": "Needs timing and payment details to fit unpredictable cash flow.",
        "likelyMisunderstanding": "May think the bank can account for future gig deposits automatically.",
        "supportNeed": "Clear first payment date, review step, and reminder before money moves.",
    },
    {
        "name": "Noah",
        "shortLabel": "Renter moving flats",
        "tags": ["Everyday customer", "Shared household finances", "Financial vulnerability"],
        "incomePattern": "Regular wages with short-term moving costs",
        "digitalConfidence": "Medium",
        "languageNeed": "Low",
        "accessibilityNeed": "None",
        "financialStress": "High",
        "privacySensitivity": "Medium",
        "mainConcern": "Wants to avoid duplicate bills or taking on the wrong household responsibility.",
        "likelyMisunderstanding": "May miss who owns the provider account or direct debit authority.",
        "supportNeed": "Plain ownership wording and easy cancel/back controls.",
    },
    {
        "name": "Priya",
        "shortLabel": "Shared household organiser",
        "tags": ["Shared household finances", "Privacy-sensitive", "Everyday customer"],
        "incomePattern": "Stable salary",
        "digitalConfidence": "High",
        "languageNeed": "Low",
        "accessibilityNeed": "None",
        "financialStress": "Medium",
        "privacySensitivity": "High",
        "mainConcern": "Needs private account and utility details protected in shared contexts.",
        "likelyMisunderstanding": "May not realise which details are visible to the provider or household members.",
        "supportNeed": "Discreet notifications and clear data sharing boundaries.",
    },
    {
        "name": "James",
        "shortLabel": "Small business owner",
        "tags": ["Small business overlap", "Irregular income", "Operational risk"],
        "incomePattern": "Large irregular invoice payments",
        "digitalConfidence": "High",
        "languageNeed": "Low",
        "accessibilityNeed": "None",
        "financialStress": "Medium",
        "privacySensitivity": "Medium",
        "mainConcern": "Needs to choose the right account and avoid mixing personal and business payments.",
        "likelyMisunderstanding": "May assume provider setup can draw from several accounts or invoice timing.",
        "supportNeed": "Masked account numbers, account labels, and edit controls.",
    },
    {
        "name": "Mei",
        "shortLabel": "Additional language",
        "tags": ["English as an additional language", "Accessibility needs", "New-to-bank customers"],
        "incomePattern": "Stable income",
        "digitalConfidence": "Medium",
        "languageNeed": "High",
        "accessibilityNeed": "Medium",
        "financialStress": "Medium",
        "privacySensitivity": "High",
        "mainConcern": "Needs consent, data sharing, and direct debit terms to be unambiguous.",
        "likelyMisunderstanding": "May read continue as final consent rather than a review step.",
        "supportNeed": "Plain language, short sentences, and clear confirm/cancel labels.",
    },
    {
        "name": "Margaret",
        "shortLabel": "Older customer",
        "tags": ["Older customers", "Low digital confidence", "Accessibility needs"],
        "incomePattern": "Fixed pension income",
        "digitalConfidence": "Low",
        "languageNeed": "Medium",
        "accessibilityNeed": "Medium",
        "financialStress": "Medium",
        "privacySensitivity": "High",
        "mainConcern": "Needs reassurance that nothing starts until she confirms.",
        "likelyMisunderstanding": "May be unsure whether BNZ or the provider is asking for consent.",
        "supportNeed": "Step-by-step copy, larger touch targets, and support contact.",
    },
]


def build_mock_personas(
    feature_name: str,
    banking_message: str,
    target_customers: str,
    channel: str,
    send_timing: str,
    persona_count: int,
) -> list[GeneratedPersona]:
    personas: list[GeneratedPersona] = []
    for index in range(persona_count):
        template = TEMPLATES[index % len(TEMPLATES)]
        name = template["name"] if index < len(TEMPLATES) else f"{template['name']} {index + 1}"
        personas.append(
            GeneratedPersona(
                id=f"persona_{index + 1}",
                name=name,
                ageRange=AGE_RANGES[index % len(AGE_RANGES)],
                shortLabel=str(template["shortLabel"]),
                tags=list(template["tags"]),
                lifeContext=(
                    f"{name} is part of {target_customers.rstrip('.')}. They are reviewing "
                    f"{feature_name} in the {channel.lower()} around this trigger: {send_timing}."
                ),
                incomePattern=str(template["incomePattern"]),
                digitalConfidence=str(template["digitalConfidence"]),
                languageNeed=str(template["languageNeed"]),
                accessibilityNeed=str(template["accessibilityNeed"]),
                financialStress=str(template["financialStress"]),
                privacySensitivity=str(template["privacySensitivity"]),
                bankingContext=(
                    f"Feature copy shown: {banking_message[:180]}"
                    if banking_message
                    else None
                ),
                mainConcern=str(template["mainConcern"]),
                likelyMisunderstanding=str(template["likelyMisunderstanding"]),
                supportNeed=str(template["supportNeed"]),
                custom=False,
            )
        )
    return personas
