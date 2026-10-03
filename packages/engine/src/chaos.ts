import { setTimeout as sleep } from "node:timers/promises";
import { BayarLabError, type DeliveryResult, type WireRequest } from "@bayarlab/core";
import { type DeliveryOptions, deliver } from "./delivery.js";
import { MAX_REQUEST_BYTES, validateHeaders } from "./request.js";
import { resolveTarget } from "./target.js";

export interface ChaosMutation {
  signature?: { location: "body" | "header"; name: string; mode: "invalid" | "missing" };
  removeFields?: readonly string[];
  setFields?: Readonly<Record<string, unknown>>;
  malformedBody?: boolean;
}

function invalid(message: string): never {
  throw new BayarLabError("INVALID_REQUEST", message);
}

/** Mutate a copy AFTER signing; never authenticate the mutated body again. */
export function mutateRequest(source: WireRequest, mutation: ChaosMutation = {}): WireRequest {
  if (source.method !== "POST" || !(source.body instanceof Uint8Array)) {
    invalid("Chaos requires a POST wire request with byte body.");
  }
  validateHeaders(source.headers);
  const request = {
    ...source,
    headers: { ...source.headers },
    metadata: { ...source.metadata },
    body: new Uint8Array(source.body),
  };
  const signature = mutation.signature;
  if (
    signature &&
    (!["body", "header"].includes(signature.location) ||
      !["invalid", "missing"].includes(signature.mode) ||
      !signature.name)
  )
    invalid("Invalid signature mutation.");
  const mutateSignature = (record: Record<string, unknown>, name: string) => {
    const value = record[name];
    if (typeof value !== "string" || !value) invalid("Signature field is absent or not a string.");
    if (signature?.mode === "missing") delete record[name];
    else record[name] = (value.startsWith("0") ? "1" : "0") + value.slice(1);
  };
  if (signature?.location === "header") {
    const name = Object.keys(request.headers).find(
      (key) => key.toLowerCase() === signature.name.toLowerCase(),
    );
    if (!name) invalid("Signature header is absent.");
    mutateSignature(request.headers, name);
  }
  validateHeaders(request.headers);
  if (signature?.location === "body" || mutation.removeFields?.length || mutation.setFields) {
    let body: unknown;
    try {
      body = JSON.parse(Buffer.from(request.body).toString("utf8"));
    } catch {
      invalid("Payload mutations require a JSON object.");
    }
    if (!body || typeof body !== "object" || Array.isArray(body))
      invalid("Payload mutations require a JSON object.");
    const record = body as Record<string, unknown>;
    for (const field of [
      ...(mutation.removeFields ?? []),
      ...Object.keys(mutation.setFields ?? {}),
    ]) {
      if (!field || ["__proto__", "constructor", "prototype"].includes(field))
        invalid("Invalid payload field.");
      if (signature && field === signature.name)
        invalid("Payload and signature mutations overlap.");
    }
    for (const field of mutation.removeFields ?? []) delete record[field];
    // defineProperty treats arbitrary field names as own data, never prototype setters.
    for (const [field, value] of Object.entries(mutation.setFields ?? {})) {
      Object.defineProperty(record, field, {
        value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    if (signature?.location === "body") mutateSignature(record, signature.name);
    try {
      request.body = Buffer.from(JSON.stringify(record));
    } catch {
      invalid("Mutated payload must be JSON serializable.");
    }
  }
  // Appending a token makes even an otherwise-valid JSON document invalid.
  if (mutation.malformedBody) request.body = Buffer.concat([request.body, Buffer.from("\n!")]);
  if (request.body.byteLength > MAX_REQUEST_BYTES)
    throw new BayarLabError("REQUEST_TOO_LARGE", "Mutated request exceeds 1 MiB.");
  return request;
}

export interface ResponseAssertions {
  status?: number;
  bodyIncludes?: string;
  maxDurationMs?: number;
  error?: "TIMEOUT" | "NETWORK_ERROR";
}

export function validateAssertions(expect: ResponseAssertions): void {
  if (
    expect.status !== undefined &&
    (!Number.isInteger(expect.status) || expect.status < 100 || expect.status > 599)
  )
    invalid("Expected status must be 100–599.");
  if (
    expect.maxDurationMs !== undefined &&
    (!Number.isFinite(expect.maxDurationMs) || expect.maxDurationMs < 0)
  )
    invalid("Expected duration must be non-negative.");
  if (expect.bodyIncludes !== undefined && typeof expect.bodyIncludes !== "string")
    invalid("Expected body must be a string.");
  if (expect.error !== undefined && !["TIMEOUT", "NETWORK_ERROR"].includes(expect.error))
    invalid("Unsupported expected transport error.");
  if (expect.error && (expect.status !== undefined || expect.bodyIncludes !== undefined))
    invalid("Transport-error expectations cannot include HTTP response assertions.");
}

export function assertResponse(result: DeliveryResult, expect: ResponseAssertions = {}): string[] {
  validateAssertions(expect);
  const failures: string[] = [];
  if (expect.error) {
    if (result.error?.code !== expect.error)
      failures.push("Expected transport error was not observed.");
  } else if (result.error || !result.response) failures.push("No complete HTTP response.");
  else {
    const status = result.response.status;
    if (expect.status === undefined ? status < 200 || status >= 300 : status !== expect.status)
      failures.push("HTTP status did not match expectation.");
    if (
      expect.bodyIncludes !== undefined &&
      (result.response.truncated || !result.response.body.includes(expect.bodyIncludes))
    )
      failures.push("Complete response body did not contain expected text.");
  }
  if (expect.maxDurationMs !== undefined && result.durationMs > expect.maxDurationMs)
    failures.push("Delivery exceeded expected duration.");
  return failures;
}

export interface ReliabilityStep {
  name: string;
  request: WireRequest;
  mutation?: ChaosMutation;
  copies?: number;
  delayMs?: number;
  expect?: ResponseAssertions;
}
export interface ReliabilityAttempt {
  step: string;
  copy: number;
  result: DeliveryResult;
  failures: string[];
}
export interface ReliabilityReport {
  passed: boolean;
  attempts: ReliabilityAttempt[];
}

/** Prepares the entire run before sending, then executes sequentially, retaining all results. */
export async function runReliabilityScenario(
  steps: readonly ReliabilityStep[],
  options: DeliveryOptions & { reverse?: boolean; signal?: AbortSignal } = {},
): Promise<ReliabilityReport> {
  if (!steps.length || steps.length > 100) invalid("Scenario requires 1–100 steps.");
  const timeout = options.timeoutMs ?? 15_000;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 120_000)
    invalid("Timeout must be 1–120000 ms.");
  let count = 0;
  let waiting = 0;
  const prepared = steps.map((step) => {
    const copies = step.copies ?? 1;
    const delayMs = step.delayMs ?? 0;
    if (!Number.isSafeInteger(copies) || copies < 1 || copies > 100)
      invalid("Copies must be 1–100 total attempts per step.");
    if (!Number.isSafeInteger(delayMs) || delayMs < 0 || delayMs > 60_000)
      invalid("Delay must be 0–60000 ms per attempt.");
    count += copies;
    waiting += delayMs * copies;
    validateAssertions(step.expect ?? {});
    return { ...step, copies, delayMs, request: mutateRequest(step.request, step.mutation) };
  });
  if (count > 100 || waiting > 300_000)
    invalid("Scenario exceeds 100 attempts or 300000 ms total delay.");
  // Delivery resolves and validates again at each attempt, so DNS changes never bypass policy.
  for (const target of new Set(prepared.map((step) => step.request.targetUrl))) {
    await resolveTarget(target, options.allowRemoteTarget);
  }
  if (options.reverse) prepared.reverse();
  const attempts: ReliabilityAttempt[] = [];
  for (const step of prepared) {
    for (let copy = 1; copy <= step.copies; copy += 1) {
      options.signal?.throwIfAborted();
      if (step.delayMs) await sleep(step.delayMs, undefined, { signal: options.signal });
      const result = await deliver(step.request, {
        timeoutMs: timeout,
        allowRemoteTarget: options.allowRemoteTarget === true,
      });
      attempts.push({
        step: step.name,
        copy,
        result,
        failures: assertResponse(result, step.expect),
      });
    }
  }
  return { passed: attempts.every((attempt) => attempt.failures.length === 0), attempts };
}
