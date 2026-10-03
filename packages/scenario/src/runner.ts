import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { setTimeout as sleep } from "node:timers/promises";

import { BayarLabError, type WireRequest } from "@bayarlab/core";
import {
  assertResponse,
  type ChaosMutation,
  deliver,
  mutateRequest,
  prepareSignedRequest,
  type ResponseAssertions,
  resolveTarget,
  toDisplayResult,
} from "@bayarlab/engine";
import type { ProviderAdapter } from "@bayarlab/provider-contract";
import { dokuAdapter } from "@bayarlab/provider-doku";
import { midtransAdapter } from "@bayarlab/provider-midtrans";
import { xenditAdapter } from "@bayarlab/provider-xendit";
import { parse as parseYaml } from "yaml";

import { deriveId, deriveTimestamp } from "./deterministic.js";
import type { ScenarioReport, StepReport } from "./report.js";
import {
  type EventStep,
  isEventStep,
  isWaitStep,
  type ScenarioFile,
  scenarioFileSchema,
} from "./schema.js";

// ---------------------------------------------------------------------------
// Provider registry
// ---------------------------------------------------------------------------

function resolveAdapter(provider: string): ProviderAdapter {
  if (provider === "midtrans") return midtransAdapter;
  if (provider === "xendit") return xenditAdapter;
  if (provider === "doku") return dokuAdapter;
  throw new BayarLabError("INVALID_REQUEST", `Unsupported provider: ${provider}`);
}

// ---------------------------------------------------------------------------
// Parse scenario file
// ---------------------------------------------------------------------------

export interface ParseResult {
  scenario: ScenarioFile;
  errors: string[];
}

export async function parseScenarioFile(filePath: string): Promise<ParseResult> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (cause) {
    return {
      scenario: undefined as unknown as ScenarioFile,
      errors: [`Failed to read file: ${(cause as Error).message}`],
    };
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (cause) {
    return {
      scenario: undefined as unknown as ScenarioFile,
      errors: [`YAML parse error: ${(cause as Error).message}`],
    };
  }

  const result = scenarioFileSchema.safeParse(parsed);
  if (!result.success) {
    return {
      scenario: undefined as unknown as ScenarioFile,
      errors: result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    };
  }
  return { scenario: result.data, errors: [] };
}

// ---------------------------------------------------------------------------
// Run options
// ---------------------------------------------------------------------------

export interface RunScenarioOptions {
  allowRemoteTarget?: boolean;
  timeoutMs?: number;
  seedOverride?: string;
  signal?: AbortSignal;
  secrets?: readonly string[];
  dokuClientId?: string;
}

// ---------------------------------------------------------------------------
// Build mutation from step options
// ---------------------------------------------------------------------------

function buildMutation(step: EventStep, provider: string): ChaosMutation {
  const options = step.options;
  if (!options) return {};

  return {
    ...(options.invalid_signature || options.missing_signature
      ? {
          signature: {
            location: provider === "midtrans" ? ("body" as const) : ("header" as const),
            name:
              provider === "doku"
                ? "Signature"
                : provider === "xendit"
                  ? "x-callback-token"
                  : "signature_key",
            mode: options.missing_signature ? ("missing" as const) : ("invalid" as const),
          },
        }
      : {}),
    removeFields: options.remove_fields ?? [],
    setFields: options.set_fields ?? {},
    malformedBody: options.malformed_body === true,
  };
}

// ---------------------------------------------------------------------------
// Build response assertions from step expect
// ---------------------------------------------------------------------------

function buildAssertions(step: EventStep): ResponseAssertions {
  const expect = step.expect;
  if (!expect) return {};

  return {
    ...(expect.status !== undefined ? { status: expect.status } : {}),
    ...(expect.body_includes !== undefined ? { bodyIncludes: expect.body_includes } : {}),
    ...(expect.max_duration_ms !== undefined ? { maxDurationMs: expect.max_duration_ms } : {}),
    ...(expect.error !== undefined ? { error: expect.error } : {}),
  };
}

// ---------------------------------------------------------------------------
// Scenario runner
// ---------------------------------------------------------------------------

export async function runScenario(
  scenario: ScenarioFile,
  filePath: string,
  options: RunScenarioOptions = {},
): Promise<ScenarioReport> {
  const parsed = scenarioFileSchema.safeParse(scenario);
  if (!parsed.success) {
    throw new BayarLabError(
      "INVALID_REQUEST",
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
    );
  }
  scenario = parsed.data;
  const adapter = resolveAdapter(scenario.provider);
  const timeoutMs = options.timeoutMs ?? 15_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
    throw new BayarLabError("INVALID_REQUEST", "Timeout must be 1–120000 milliseconds.");
  }
  const seed = options.seedOverride ?? scenario.deterministic?.seed;
  const baseTimestamp = scenario.deterministic?.timestamp;
  const secret =
    options.secrets?.[0] ??
    (scenario.provider === "doku"
      ? "bayarlab-local-doku-secret"
      : scenario.provider === "xendit"
        ? "bayarlab-local-xendit-token"
        : "bayarlab-local-test-key");
  const secrets = options.secrets ?? [secret];
  if (baseTimestamp) deriveTimestamp(baseTimestamp, 0);
  await resolveTarget(scenario.target, options.allowRemoteTarget === true);

  const stepReports: StepReport[] = [];
  const started = performance.now();

  // Preflight every event before the first delivery: input mistakes are not assertion failures.
  const preparedRequests = new Map<number, WireRequest>();
  const transactionsByOrder = new Map<string, string>();
  // Track the last event step's identity for duplicate reuse
  let lastEventIdentity: { orderId: string; transactionId: string; eventId: string } | undefined;
  let lastEventTime: Date | undefined;
  let lastEventScenario: string | undefined;

  let eventStepIndex = 0;

  for (const [i, step] of scenario.steps.entries()) {
    options.signal?.throwIfAborted();

    if (isWaitStep(step)) {
      continue;
    }

    // Event step
    if (!isEventStep(step)) continue;

    const isDuplicate = step.options?.duplicate === true;

    // Determine IDs
    let orderId: string | undefined;
    let transactionId: string | undefined;
    let eventId: string | undefined;
    let now: Date;

    if (isDuplicate && lastEventIdentity) {
      // Reuse the previous event's identity for idempotency testing
      orderId = lastEventIdentity.orderId;
      transactionId = lastEventIdentity.transactionId;
      eventId = lastEventIdentity.eventId;
    } else if (seed) {
      orderId =
        scenario.variables?.order_id ?? `BL-${deriveId(seed, eventStepIndex, "order").slice(0, 8)}`;
      transactionId =
        scenario.variables?.transaction_id ?? deriveId(seed, eventStepIndex, "transaction");
      eventId = deriveId(seed, eventStepIndex, "event");
    } else {
      orderId = scenario.variables?.order_id ?? `BL-${randomUUID().slice(0, 8)}`;
      transactionId = scenario.variables?.transaction_id ?? randomUUID();
      eventId = randomUUID();
    }
    if (!isDuplicate && orderId && transactionId) {
      transactionId = transactionsByOrder.get(orderId) ?? transactionId;
      transactionsByOrder.set(orderId, transactionId);
    }

    if (isDuplicate && lastEventTime) {
      now = lastEventTime;
    } else if (baseTimestamp) {
      now = deriveTimestamp(baseTimestamp, eventStepIndex);
    } else {
      now = new Date();
    }

    if (isDuplicate && lastEventScenario !== step.event) {
      throw new BayarLabError(
        "INVALID_REQUEST",
        "Duplicate must repeat the immediately previous event scenario.",
      );
    }

    // Resolve the scenario definition for this event
    const scenarioDefinition = adapter.listScenarios().find((s) => s.id === step.event);
    if (!scenarioDefinition) {
      throw new BayarLabError("INVALID_REQUEST", `Unknown scenario: ${step.event}`);
    }

    const product = step.product ?? scenario.variables?.product ?? scenarioDefinition.product;

    // Build event
    const amount = scenario.variables?.amount;
    const event = await adapter.buildEvent({
      scenario: step.event,
      product,
      ...(amount !== undefined ? { amount } : {}),
      ...(orderId !== undefined ? { orderId } : {}),
      ...(transactionId !== undefined ? { transactionId } : {}),
      ...(eventId !== undefined ? { eventId } : {}),
      now,
    });

    // Sign
    const wireRequest = await prepareSignedRequest(adapter, event, scenario.target, {
      secret,
      ...(scenario.provider === "doku"
        ? { clientId: options.dokuClientId ?? "MCH-BAYARLAB-LOCAL" }
        : {}),
    });

    // Apply mutation
    const mutation = buildMutation(step, scenario.provider);
    const hasMutation =
      mutation.signature !== undefined ||
      (mutation.removeFields && mutation.removeFields.length > 0) ||
      (mutation.setFields && Object.keys(mutation.setFields).length > 0) ||
      mutation.malformedBody === true;
    const finalRequest = hasMutation ? mutateRequest(wireRequest, mutation) : wireRequest;

    preparedRequests.set(i, finalRequest);

    // Track identity for future duplicate steps
    if (!isDuplicate) {
      // Use the built event to capture the actual generated IDs
      const body = event.body as Record<string, unknown>;
      const nestedData = body.data;
      const nestedReference =
        nestedData !== null && typeof nestedData === "object" && !Array.isArray(nestedData)
          ? (nestedData as Record<string, unknown>).reference_id
          : undefined;
      const nestedOrder = body.order;
      const nestedInvoice =
        nestedOrder !== null && typeof nestedOrder === "object" && !Array.isArray(nestedOrder)
          ? (nestedOrder as Record<string, unknown>).invoice_number
          : undefined;
      lastEventIdentity = {
        orderId:
          typeof body.order_id === "string"
            ? body.order_id
            : typeof nestedReference === "string"
              ? nestedReference
              : typeof nestedInvoice === "string"
                ? nestedInvoice
                : (orderId ?? ""),
        transactionId: event.metadata.transactionId ?? "",
        eventId: event.metadata.eventId,
      };
      lastEventTime = now;
      lastEventScenario = step.event;
    }

    if (!isDuplicate) {
      eventStepIndex++;
    }
  }

  for (const [i, step] of scenario.steps.entries()) {
    options.signal?.throwIfAborted();
    const stepStarted = performance.now();
    if (isWaitStep(step)) {
      if (step.wait > 0) await sleep(step.wait, undefined, { signal: options.signal });
      stepReports.push({
        index: i,
        type: "wait",
        name: `wait:${step.wait}ms`,
        passed: true,
        failures: [],
        durationMs: Math.round(performance.now() - stepStarted),
      });
      continue;
    }
    const request = preparedRequests.get(i);
    if (!request) throw new BayarLabError("INVALID_REQUEST", "Missing prepared event.");
    // Delivery re-resolves the target on every attempt; preflight is not a DNS-policy bypass.
    const result = await deliver(request, {
      timeoutMs,
      allowRemoteTarget: options.allowRemoteTarget === true,
    });
    const failures = assertResponse(result, buildAssertions(step));
    stepReports.push({
      index: i,
      type: "event",
      name: step.event,
      passed: failures.length === 0,
      failures,
      result: toDisplayResult(result, secrets),
      durationMs: Math.round(performance.now() - stepStarted),
    });
  }

  const totalDuration = Math.round(performance.now() - started);
  const passed = stepReports.filter((s) => s.passed).length;
  const failed = stepReports.filter((s) => !s.passed).length;

  return {
    file: filePath,
    provider: scenario.provider,
    passed: failed === 0,
    summary: {
      total: stepReports.length,
      passed,
      failed,
      skipped: 0,
    },
    steps: stepReports,
    durationMs: totalDuration,
  };
}
