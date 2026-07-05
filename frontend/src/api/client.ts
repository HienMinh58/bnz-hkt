import type {
  FeatureTestInput,
  GeneratePersonasResponse,
  GeneratedPersona,
  SimulationForm,
  SimulationResponse,
} from "../types/simulation";

const GENERATE_PERSONAS_TIMEOUT_MS = 90_000;

function toLegacySimulationForm(form: FeatureTestInput | SimulationForm): SimulationForm {
  if ("customerFacingCopy" in form) {
    return {
      featureName: form.featureName,
      bankingMessage: [
        form.customerFacingCopy,
        form.featureDescription ? `Feature context: ${form.featureDescription}` : "",
        form.expectedCustomerAction
          ? `Expected customer action: ${form.expectedCustomerAction}`
          : "",
        form.dataUsedShared ? `Data used/shared: ${form.dataUsedShared}` : "",
        form.riskFocus.length ? `Risk focus: ${form.riskFocus.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
      targetCustomers: form.targetCustomerSegment,
      channel: form.channel,
      sendTiming: form.shownTiming,
      personaCount: form.personaCount,
      screenshot: form.screenshot,
    };
  }
  return form;
}

export async function generatePersonas(
  form: FeatureTestInput | SimulationForm,
): Promise<GeneratePersonasResponse> {
  const legacyForm = toLegacySimulationForm(form);
  const startedAt = performance.now();
  const controller = new AbortController();
  const timeoutId = window.setTimeout(
    () => controller.abort(),
    GENERATE_PERSONAS_TIMEOUT_MS,
  );
  console.info("/api/generate-personas request started", {
    featureName: legacyForm.featureName,
    personaCount: legacyForm.personaCount,
    startedAt: new Date().toISOString(),
    timeoutMs: GENERATE_PERSONAS_TIMEOUT_MS,
  });

  try {
    const response = await fetch("/api/generate-personas", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        featureName: legacyForm.featureName,
        bankingMessage: legacyForm.bankingMessage,
        targetCustomers: legacyForm.targetCustomers,
        channel: legacyForm.channel,
        sendTiming: legacyForm.sendTiming,
        personaCount: legacyForm.personaCount,
      }),
    });
    const durationMs = Math.round(performance.now() - startedAt);
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      const detail = payload?.detail;
      const requestId = detail?.requestId ?? payload?.requestId ?? null;
      const error = detail?.error ?? payload?.error ?? "Persona generation failed";
      const backendDurationMs = detail?.durationMs ?? payload?.durationMs ?? null;
      console.error("/api/generate-personas request failed", {
        requestId,
        status: response.status,
        error,
        durationMs,
        backendDurationMs,
        receivedAt: new Date().toISOString(),
      });
      throw new Error(
        requestId
          ? `Persona generation failed (${requestId}): ${error}`
          : `Persona generation failed: ${error}`,
      );
    }

    const data = payload as GeneratePersonasResponse;
    console.info("/api/generate-personas response received", {
      requestId: data.requestId,
      durationMs,
      backendDurationMs: data.durationMs,
      personaCount: data.personas.length,
      receivedAt: new Date().toISOString(),
    });
    return data;
  } catch (error) {
    const durationMs = Math.round(performance.now() - startedAt);
    if (error instanceof DOMException && error.name === "AbortError") {
      console.error("/api/generate-personas request timed out", {
        durationMs,
        timeoutMs: GENERATE_PERSONAS_TIMEOUT_MS,
        receivedAt: new Date().toISOString(),
      });
      throw new Error(
        `Persona generation timed out after ${Math.round(
          GENERATE_PERSONAS_TIMEOUT_MS / 1000,
        )} seconds. Try again with fewer personas or retry later.`,
      );
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export async function runSimulation(
  form: FeatureTestInput | SimulationForm,
  personas: GeneratedPersona[],
): Promise<SimulationResponse> {
  const legacyForm = toLegacySimulationForm(form);
  const body = new FormData();
  body.append("featureName", legacyForm.featureName);
  body.append("bankingMessage", legacyForm.bankingMessage);
  body.append("targetCustomers", legacyForm.targetCustomers);
  body.append("channel", legacyForm.channel);
  body.append("sendTiming", legacyForm.sendTiming);
  body.append("personas", JSON.stringify(personas));
  if (legacyForm.screenshot) {
    body.append("screenshot", legacyForm.screenshot);
  }

  const response = await fetch("/api/run-simulation", {
    method: "POST",
    body,
  });
  if (!response.ok) {
    throw new Error("Simulation failed");
  }
  return response.json();
}
