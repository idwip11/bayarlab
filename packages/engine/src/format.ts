import type { DeliveryResult } from "@bayarlab/core";

const REDACTED = "[REDACTED]";
const SENSITIVE_HEADER = /authorization|cookie|token|secret|signature|api[-_]?key/i;
const SENSITIVE_FIELD = /signature|secret|token|password|authorization|api[-_]?key|^key$/i;

function maskSecrets(value: string, secrets: readonly string[]): string {
  return secrets.reduce(
    (text, secret) => (secret.length > 0 ? text.replaceAll(secret, REDACTED) : text),
    value,
  );
}

export function redactTargetUrl(value: string, secrets: readonly string[] = []): string {
  try {
    const url = new URL(value);
    url.username = url.username ? REDACTED : "";
    url.password = url.password ? REDACTED : "";
    url.pathname = url.pathname
      .split("/")
      .map((part) => encodeURIComponent(maskSecrets(decodeURIComponent(part), secrets)))
      .join("/");
    const params = new URLSearchParams();
    for (const [key, item] of url.searchParams) {
      params.append(
        maskSecrets(key, secrets),
        SENSITIVE_FIELD.test(key) ? REDACTED : maskSecrets(item, secrets),
      );
    }
    url.search = params.toString();
    url.hash = maskSecrets(decodeURIComponent(url.hash), secrets);
    return maskSecrets(url.toString(), secrets);
  } catch {
    return "[Invalid target URL omitted]";
  }
}

function redactValue(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === "string") return maskSecrets(value, secrets);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, secrets));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        maskSecrets(key, secrets),
        SENSITIVE_FIELD.test(key) ? REDACTED : redactValue(item, secrets),
      ]),
    );
  }
  return value;
}

function redactBody(body: string, secrets: readonly string[]): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return maskSecrets(body, secrets);
  }
  try {
    return JSON.stringify(redactValue(parsed, secrets));
  } catch {
    // Never fall back to raw JSON if traversal/serialization fails (e.g. extreme nesting).
    return "[JSON body omitted: redaction failed]";
  }
}

function redactHeaders(
  headers: Record<string, string>,
  secrets: readonly string[],
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      SENSITIVE_HEADER.test(name) ? REDACTED : maskSecrets(value, secrets),
    ]),
  );
}

export interface DisplayResult {
  requestId: string;
  targetUrl: string;
  request: { method: string; headers: Record<string, string>; body: string };
  response?: { status: number; headers: Record<string, string>; body: string; truncated: boolean };
  durationMs: number;
  error?: { code: string; message: string };
}

export function toDisplayResult(result: DeliveryResult, secrets: readonly string[]): DisplayResult {
  const reflectedSecrets = [...secrets];
  for (const [name, value] of Object.entries(result.request.headers)) {
    if (SENSITIVE_HEADER.test(name)) reflectedSecrets.push(value);
  }
  // Extract JSON string literals even from deliberately malformed bodies.
  const rawBody = Buffer.from(result.request.body).toString("utf8");
  const matches = rawBody.matchAll(/"signature_key"\s*:\s*("(?:[^"\\]|\\.)*")/g);
  for (const match of matches) {
    if (match[1]) {
      try {
        reflectedSecrets.push(JSON.parse(match[1]) as string);
      } catch {
        /* Invalid literal is omitted below. */
      }
    }
  }
  let requestBody: string;
  try {
    JSON.parse(Buffer.from(result.request.body).toString("utf8"));
    requestBody = redactBody(rawBody, reflectedSecrets);
  } catch {
    // Invalid JSON cannot be reliably field-redacted. Raw bytes remain available for replay.
    requestBody = "[Non-JSON request body omitted]";
  }
  const display: DisplayResult = {
    requestId: result.requestId,
    targetUrl: redactTargetUrl(result.targetUrl, reflectedSecrets),
    request: {
      method: result.request.method,
      headers: redactHeaders(result.request.headers, reflectedSecrets),
      body: requestBody,
    },
    durationMs: result.durationMs,
  };
  if (result.response) {
    display.response = {
      ...result.response,
      headers: redactHeaders(result.response.headers, reflectedSecrets),
      body: redactBody(result.response.body, reflectedSecrets),
    };
  }
  if (result.error)
    display.error = {
      code: result.error.code,
      message: maskSecrets(result.error.message, reflectedSecrets),
    };
  return display;
}

export function formatDelivery(
  result: DeliveryResult,
  output: "text" | "json",
  secrets: readonly string[],
): string {
  const safe = toDisplayResult(result, secrets);
  if (output === "json") return JSON.stringify(safe);
  const outcome = safe.error
    ? `Error ${safe.error.code}: ${safe.error.message}`
    : `HTTP ${safe.response?.status ?? 0}${safe.response?.truncated ? " (response truncated)" : ""}`;
  return [
    `POST ${safe.targetUrl}`,
    `${outcome} · ${safe.durationMs} ms`,
    `Request: ${safe.request.body}`,
    `Response: ${safe.response?.body ?? ""}`,
  ].join("\n");
}
