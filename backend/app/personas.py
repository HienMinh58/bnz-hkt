from app.models import LegacyPersona


PERSONAS: list[LegacyPersona] = [
    LegacyPersona(
        name="Aroha",
        segment="Student",
        income_pattern="part-time, irregular",
        balance=94.30,
        upcoming_bills=["rent", "phone"],
        financial_confidence="low",
        language_clarity_need="medium",
        risk_context="may feel anxious about money",
    ),
    LegacyPersona(
        name="Mei",
        segment="New migrant",
        income_pattern="stable but new to NZ banking",
        balance=180.50,
        upcoming_bills=["rent", "power"],
        financial_confidence="medium",
        language_clarity_need="high",
        risk_context="may misunderstand banking terms",
    ),
    LegacyPersona(
        name="James",
        segment="Small business owner",
        income_pattern="large irregular invoice payments",
        balance=230.00,
        upcoming_bills=["supplier payment", "GST"],
        financial_confidence="high",
        language_clarity_need="low",
        risk_context=(
            "balance warnings may be inaccurate because income arrives irregularly"
        ),
    ),
    LegacyPersona(
        name="Tane",
        segment="Single parent",
        income_pattern="salary plus child support",
        balance=75.20,
        upcoming_bills=["groceries", "childcare"],
        financial_confidence="medium",
        language_clarity_need="medium",
        risk_context="warning may increase stress if no support option is shown",
    ),
    LegacyPersona(
        name="Olivia",
        segment="First-home buyer",
        income_pattern="stable salary",
        balance=420.00,
        upcoming_bills=["mortgage", "insurance"],
        financial_confidence="high",
        language_clarity_need="low",
        risk_context="strict savings goal",
    ),
    LegacyPersona(
        name="Margaret",
        segment="Retiree",
        income_pattern="fixed pension",
        balance=310.00,
        upcoming_bills=["utilities", "medical"],
        financial_confidence="medium",
        language_clarity_need="medium",
        risk_context="needs clear and reassuring wording",
    ),
]
