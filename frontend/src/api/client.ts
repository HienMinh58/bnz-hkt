import type {
  AdAnalysisRequest,
  AdAnalysisResponse,
  AdvisorChatRequest,
  AdvisorChatResponse,
  AudienceFitRequest,
  AudienceFitResponse,
  FeatureTestInput,
  GeneratePersonasResponse,
  GeneratedPersona,
  SimulationJobCreateResponse,
  SimulationJobStatusResponse,
  SimulationForm,
  SimulationResponse,
} from "../types/simulation";
import { supabase } from "./supabaseClient";

const ANALYZE_AD_TIMEOUT_MS = 120_000;
const AUDIENCE_FIT_TIMEOUT_MS = 240_000;
const GENERATE_PERSONAS_TIMEOUT_MS = 330_000;
const RUN_SIMULATION_TIMEOUT_MS = 330_000;
const CREATE_SIMULATION_JOB_TIMEOUT_MS = 60_000;
const SIMULATION_JOB_POLL_INTERVAL_MS = 3_000;
const SIMULATION_JOB_POLL_TIMEOUT_MS = 10 * 60_000;
const ADVISOR_CHAT_TIMEOUT_MS = 180_000;

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    throw new Error("Please sign in before running a simulation.");
  }
  return { Authorization: `Bearer ${token}` };
}

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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
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
        ...(await authHeaders()),
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
        ...(await authHeaders()),
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
        ...(await authHeaders()),
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
    CREATE_SIMULATION_JOB_TIMEOUT_MS,
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

  console.info("/api/run-simulation-jobs request started", {
    featureName: legacyForm.featureName,
    personaCount: personas.length,
    imageUploaded: Boolean(legacyForm.screenshot),
    startedAt: new Date().toISOString(),
    timeoutMs: CREATE_SIMULATION_JOB_TIMEOUT_MS,
  });

  try {
    const response = await fetch("/api/run-simulation-jobs", {
      method: "POST",
      headers: await authHeaders(),
      body,
      signal: controller.signal,
    });
    const durationMs = Math.round(performance.now() - startedAt);
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      const detail = payload?.detail;
      const requestId = detail?.requestId ?? payload?.requestId ?? null;
      const error =
        detail?.error ?? payload?.error ?? "Simulation job creation failed";
      const backendDurationMs = detail?.durationMs ?? payload?.durationMs ?? null;
      console.error("/api/run-simulation-jobs request failed", {
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
          ? `Simulation job creation failed (${requestId}): ${error}`
          : `Simulation job creation failed: ${error}`,
      );
    }

    const job = payload as SimulationJobCreateResponse;
    console.info("/api/run-simulation-jobs response received", {
      jobId: job.jobId,
      requestId: job.requestId,
      durationMs,
      receivedAt: new Date().toISOString(),
    });
    return await pollSimulationJob(job.jobId, startedAt);
  } catch (error) {
    const durationMs = Math.round(performance.now() - startedAt);
    if (error instanceof DOMException && error.name === "AbortError") {
      console.error("/api/run-simulation-jobs request timed out", {
        durationMs,
        timeoutMs: CREATE_SIMULATION_JOB_TIMEOUT_MS,
        receivedAt: new Date().toISOString(),
      });
      throw new Error(
        `Simulation job creation timed out after ${Math.round(
          CREATE_SIMULATION_JOB_TIMEOUT_MS / 1000,
        )} seconds. Try again or retry later.`,
      );
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function pollSimulationJob(
  jobId: string,
  startedAt: number,
): Promise<SimulationResponse> {
  while (performance.now() - startedAt < SIMULATION_JOB_POLL_TIMEOUT_MS) {
    await delay(SIMULATION_JOB_POLL_INTERVAL_MS);
    const response = await fetch(`/api/run-simulation-jobs/${jobId}`, {
      method: "GET",
      headers: await authHeaders(),
    });
    const durationMs = Math.round(performance.now() - startedAt);
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      const detail = payload?.detail;
      const error = detail?.error ?? detail ?? payload?.error ?? "Simulation failed";
      console.error("/api/run-simulation-jobs poll failed", {
        jobId,
        status: response.status,
        error,
        durationMs,
        receivedAt: new Date().toISOString(),
      });
      throw new Error(`Simulation failed: ${error}`);
    }

    const job = payload as SimulationJobStatusResponse;
    console.info("/api/run-simulation-jobs poll received", {
      jobId,
      status: job.status,
      requestId: job.requestId,
      durationMs,
      receivedAt: new Date().toISOString(),
    });

    if (job.status === "completed" && job.result) {
      return job.result;
    }
    if (job.status === "failed") {
      throw new Error(`Simulation failed: ${job.error ?? "Unknown error"}`);
    }
  }

  throw new Error(
    `Simulation is still running after ${Math.round(
      SIMULATION_JOB_POLL_TIMEOUT_MS / 1000,
    )} seconds. Try again with fewer personas or without an image.`,
  );
}

export async function askSimulationAdvisor(
  request: AdvisorChatRequest,
): Promise<AdvisorChatResponse> {
  const startedAt = performance.now();
  const controller = new AbortController();
  const timeoutId = window.setTimeout(
    () => controller.abort(),
    ADVISOR_CHAT_TIMEOUT_MS,
  );

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        ...(await authHeaders()),
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
      const error = detail?.error ?? payload?.error ?? "Advisor chat failed";
      throw new Error(
        requestId
          ? `Advisor chat failed (${requestId}): ${error}`
          : `Advisor chat failed: ${error}`,
      );
    }

    console.info("/api/chat response received", {
      requestId: payload?.requestId,
      durationMs,
      backendDurationMs: payload?.durationMs,
      usedOpenAI: payload?.used_openai,
      receivedAt: new Date().toISOString(),
    });
    return payload as AdvisorChatResponse;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(
        `Advisor chat timed out after ${Math.round(
          ADVISOR_CHAT_TIMEOUT_MS / 1000,
        )} seconds. Try a shorter question or retry later.`,
      );
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}
