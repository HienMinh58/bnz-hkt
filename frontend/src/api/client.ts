import type {
  AdAnalysisRequest,
  AdAnalysisResponse,
  AudienceFitRequest,
  AudienceFitResponse,
  FeatureTestInput,
  GeneratePersonasResponse,
  GeneratedPersona,
  SimulationForm,
  SimulationResponse,
} from "../types/simulation";

const ANALYZE_AD_TIMEOUT_MS = 120_000;
const AUDIENCE_FIT_TIMEOUT_MS = 240_000;
const GENERATE_PERSONAS_TIMEOUT_MS = 330_000;
const RUN_SIMULATION_TIMEOUT_MS = 330_000;

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

export async function analyzeAd(
  request: AdAnalysisRequest,
): Promise<AdAnalysisResponse> {
  const startedAt = performance.now();
  const controller = new AbortController();
  const timeoutId = window.setTimeout(
    () => controller.abort(),
    ANALYZE_AD_TIMEOUT_MS,
  );
  console.info("/api/analyze-ad request started", {
    campaignName: request.campaignName,
    startedAt: new Date().toISOString(),
    timeoutMs: ANALYZE_AD_TIMEOUT_MS,
  });

  try {
    const response = await fetch("/api/analyze-ad", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify(request),
    });
    const durationMs = Math.round(performance.now() - startedAt);
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      const detail = payload?.detail;
      const requestId = detail?.requestId ?? payload?.requestId ?? null;
      const error = detail?.error ?? payload?.error ?? "Ad analysis failed";
      console.error("/api/analyze-ad request failed", {
        requestId,
        status: response.status,
        error,
        durationMs,
        receivedAt: new Date().toISOString(),
      });
      throw new Error(
        requestId
          ? `Ad analysis failed (${requestId}): ${error}`
          : `Ad analysis failed: ${error}`,
      );
    }

    const data = payload as AdAnalysisResponse;
    console.info("/api/analyze-ad response received", {
      requestId: data.requestId,
      durationMs,
      backendDurationMs: data.durationMs,
      openaiDurationMs: data.openaiDurationMs,
      receivedAt: new Date().toISOString(),
    });
    return data;
  } catch (error) {
    const durationMs = Math.round(performance.now() - startedAt);
    if (error instanceof DOMException && error.name === "AbortError") {
      console.error("/api/analyze-ad request timed out", {
        durationMs,
        timeoutMs: ANALYZE_AD_TIMEOUT_MS,
        receivedAt: new Date().toISOString(),
      });
      throw new Error(
        `Ad analysis timed out after ${Math.round(
          ANALYZE_AD_TIMEOUT_MS / 1000,
        )} seconds. Try again with a shorter brief or retry later.`,
      );
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export async function generateAudienceFit(
  request: AudienceFitRequest,
): Promise<AudienceFitResponse> {
  const startedAt = performance.now();
  const controller = new AbortController();
  const timeoutId = window.setTimeout(
    () => controller.abort(),
    AUDIENCE_FIT_TIMEOUT_MS,
  );
  console.info("/api/audience-fit request started", {
    campaignName: request.campaignName,
    profileCount: request.profileCount,
    startedAt: new Date().toISOString(),
    timeoutMs: AUDIENCE_FIT_TIMEOUT_MS,
  });

  try {
    const response = await fetch("/api/audience-fit", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify(request),
    });
    const durationMs = Math.round(performance.now() - startedAt);
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      const detail = payload?.detail;
      const requestId = detail?.requestId ?? payload?.requestId ?? null;
      const error = detail?.error ?? payload?.error ?? "Audience fit failed";
      throw new Error(
        requestId
          ? `Audience fit failed (${requestId}): ${error}`
          : `Audience fit failed: ${error}`,
      );
    }

    const data = payload as AudienceFitResponse;
    console.info("/api/audience-fit response received", {
      requestId: data.requestId,
      durationMs,
      backendDurationMs: data.durationMs,
      profileCount: data.profileCount,
      primarySegment: data.primarySegment,
      receivedAt: new Date().toISOString(),
    });
    return data;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(
        `Audience fit timed out after ${Math.round(
          AUDIENCE_FIT_TIMEOUT_MS / 1000,
        )} seconds. Try fewer profiles or retry later.`,
      );
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
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
  const startedAt = performance.now();
  const controller = new AbortController();
  const timeoutId = window.setTimeout(
    () => controller.abort(),
    RUN_SIMULATION_TIMEOUT_MS,
  );
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

  console.info("/api/run-simulation request started", {
    featureName: legacyForm.featureName,
    personaCount: personas.length,
    imageUploaded: Boolean(legacyForm.screenshot),
    startedAt: new Date().toISOString(),
    timeoutMs: RUN_SIMULATION_TIMEOUT_MS,
  });

  try {
    const response = await fetch("/api/run-simulation", {
      method: "POST",
      body,
      signal: controller.signal,
    });
    const durationMs = Math.round(performance.now() - startedAt);
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      const detail = payload?.detail;
      const requestId = detail?.requestId ?? payload?.requestId ?? null;
      const error = detail?.error ?? payload?.error ?? "Simulation failed";
      const backendDurationMs = detail?.durationMs ?? payload?.durationMs ?? null;
      console.error("/api/run-simulation request failed", {
        requestId,
        status: response.status,
        error,
        durationMs,
        backendDurationMs,
        openaiAttempts: detail?.openaiAttempts,
        openaiResponseId: detail?.openaiResponseId,
        openaiAttemptResponseIds: detail?.openaiAttemptResponseIds,
        openaiDurationMs: detail?.openaiDurationMs,
        receivedAt: new Date().toISOString(),
      });
      throw new Error(
        requestId
          ? `Simulation failed (${requestId}): ${error}`
          : `Simulation failed: ${error}`,
      );
    }

    const data = payload as SimulationResponse;
    console.info("/api/run-simulation response received", {
      requestId: data.requestId ?? data.developmentDebug?.requestId,
      durationMs,
      backendDurationMs: data.durationMs ?? data.developmentDebug?.durationMs,
      openaiDurationMs:
        data.openaiDurationMs ?? data.developmentDebug?.openaiDurationMs,
      postProcessingDurationMs:
        data.postProcessingDurationMs ??
        data.developmentDebug?.postProcessingDurationMs,
      openaiAttempts: data.openaiAttempts ?? data.developmentDebug?.openaiAttempts,
      openaiResponseId:
        data.openaiResponseId ?? data.developmentDebug?.openaiResponseId,
      openaiAttemptResponseIds:
        data.openaiAttemptResponseIds ??
        data.developmentDebug?.openaiAttemptResponseIds,
      receivedAt: new Date().toISOString(),
    });
    return data;
  } catch (error) {
    const durationMs = Math.round(performance.now() - startedAt);
    if (error instanceof DOMException && error.name === "AbortError") {
      console.error("/api/run-simulation request timed out", {
        durationMs,
        timeoutMs: RUN_SIMULATION_TIMEOUT_MS,
        receivedAt: new Date().toISOString(),
      });
      throw new Error(
        `Simulation timed out after ${Math.round(
          RUN_SIMULATION_TIMEOUT_MS / 1000,
        )} seconds. Try again with fewer personas, without an image, or retry later.`,
      );
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}
