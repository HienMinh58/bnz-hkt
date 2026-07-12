# Synthetic Customer Lab

Synthetic Customer Lab is a hackathon MVP for testing banking messages and UI screenshots before launch. A BNZ product team can enter a feature message, target segment, channel, timing, optional UI screenshot, and the number of personas to simulate. The app generates synthetic personas from that context, then simulates reactions against those generated personas.

The app returns clarity, trust, stress, fairness, accessibility, financial wellbeing, and operational risk signals. It is designed as an early pre-launch risk check, not a replacement for real customer research or usability testing.

## Why It Helps Banks

Banking messages can unintentionally confuse, stress, exclude, or mislead customers. This MVP gives teams a fast way to inspect those risks before release by combining:

- Dynamic synthetic persona generation across different customer contexts.
- Clear score cards for launch readiness.
- Segment-level risk badges.
- Suggested message rewrites.
- Triggered rule-based risks per generated persona.
- Optional screenshot analysis for UI text, hierarchy, button clarity, accessibility, and action clarity when OpenAI is configured.

## Project Structure

```text
synthetic-customer-lab/
  frontend/
    src/
      components/
      pages/
      api/
      types/
  backend/
    app/
      main.py
      models.py
      personas.py
      openai_client.py
      scoring.py
  README.md
  .env.example
```

## Run Backend

```bash
cd synthetic-customer-lab/backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8001
```

The Synthetic Customer Lab backend runs at `http://127.0.0.1:8001`. Keep `http://127.0.0.1:8000` available for the separate bank segmentation service.

## Run Frontend

```bash
cd synthetic-customer-lab/frontend
npm install
npm run dev
```

The frontend runs at `http://localhost:5173` and proxies `/api` calls to the FastAPI backend on port `8001`.

## OpenAI Setup

Copy `.env.example` to `.env` or set environment variables before starting the backend:

```bash
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-5.5
SEGMENTATION_SERVICE_URL=http://127.0.0.1:8000
```

The OpenAI API is called only from the backend. The frontend never receives or stores `OPENAI_API_KEY`.

If `OPENAI_API_KEY` is missing, invalid, or the OpenAI call fails, the backend returns deterministic rule-based mock results so the demo still works. If a screenshot is uploaded without OpenAI available, the app shows a placeholder explaining that image analysis requires the OpenAI API.

## Demo Scenario

Default feature:

```text
Smart overdraft warning
```

Default message:

```text
Your account may go into overdraft before Friday. Consider transferring $120 from savings or delaying non-essential spending.
```

Default target customers:

```text
Customers with low balance and upcoming bills.
```

Default channel:

```text
Mobile app notification
```

Default send timing:

```text
2 days before expected overdraft
```

## API

`GET /api/personas`

Returns the original six fixed personas for compatibility.

`POST /api/generate-personas`

Accepts JSON:

- `featureName`
- `bankingMessage`
- `targetCustomers`
- `channel`
- `sendTiming`
- `personaCount` from 3 to 12

Returns dynamically generated personas. Without OpenAI, returns deterministic mock generated personas.

`POST /api/run-simulation`

Accepts `multipart/form-data`:

- `featureName`
- `bankingMessage`
- `targetCustomers`
- `channel`
- `sendTiming`
- `personas` as JSON string
- optional `screenshot`

Returns validated structured JSON with overall scores, persona reactions, triggered rule-based risks, recommendations, better message, and optional UI screenshot analysis.

## Notes

Synthetic personas do not represent real customers. Use this MVP to surface early message and UI risks, then validate high-impact banking experiences with real accessibility checks, compliance review, operational readiness review, and customer research.
