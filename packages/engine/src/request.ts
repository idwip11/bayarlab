import { BayarLabError, type ProviderEvent, type WireRequest } from "@bayarlab/core";
import type { ProviderAdapter, SigningConfig } from "@bayarlab/provider-contract";

import { parseTarget } from "./target.js";

export const MAX_REQUEST_BYTES = 1024 * 1024;

function serializeBody(body: unknown): Uint8Array {
  let json: string | undefined;
  try {
    json = JSON.stringify(body);
  } catch (cause) {
    throw new BayarLabError("INVALID_REQUEST", "Event body is not JSON serializable.", { cause });
  }
  if (json === undefined) {
    throw new BayarLabError("INVALID_REQUEST", "Event body is not JSON serializable.");
  }
  return Buffer.from(json, "utf8");
}

export function validateHeaders(headers: Record<string, string>): void {
  const forbidden = new Set(["host", "content-length", "transfer-encoding", "connection"]);
  for (const [name, value] of Object.entries(headers)) {
    if (
      forbidden.has(name.toLowerCase()) ||
      !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) ||
      typeof value !== "string" ||
      /[\r\n]/.test(value)
    ) {
      throw new BayarLabError("INVALID_REQUEST", `Invalid or controlled request header: ${name}`);
    }
  }
}

export async function prepareSignedRequest(
  adapter: ProviderAdapter,
  event: ProviderEvent,
  targetUrl: string,
  signingConfig: SigningConfig,
): Promise<WireRequest> {
  if (event.provider !== adapter.manifest.provider || event.method !== "POST") {
    throw new BayarLabError("INVALID_REQUEST", "Event does not match its provider adapter.");
  }
  if (!event.metadata.eventId || !event.metadata.createdAt) {
    throw new BayarLabError("INVALID_REQUEST", "Event metadata needs an ID and timestamp.");
  }
  const url = parseTarget(targetUrl);
  const body = serializeBody(event.body);
  if (body.byteLength > MAX_REQUEST_BYTES) {
    throw new BayarLabError("REQUEST_TOO_LARGE", "Request body exceeds 1 MiB.");
  }
  const headers = { "content-type": "application/json", ...event.headers };
  validateHeaders(headers);
  const validation = await adapter.validateConfig(signingConfig);
  if (!validation.valid) {
    throw new BayarLabError(
      "INVALID_REQUEST",
      validation.errors.join(" ") || "Provider signing configuration is invalid.",
    );
  }

  const signed = await adapter.sign(
    {
      method: "POST",
      targetUrl: url.toString(),
      pathAndQuery: `${url.pathname}${url.search}`,
      headers: { ...headers },
      body: new Uint8Array(body),
      metadata: { ...event.metadata },
    },
    signingConfig,
  );
  validateHeaders(signed.headers);
  if (
    !signed.signature ||
    !["body", "header"].includes(signed.signature.location) ||
    typeof signed.signature.name !== "string" ||
    signed.signature.name.length === 0
  ) {
    throw new BayarLabError("INVALID_REQUEST", "Signer did not identify its signature field.");
  }
  if (
    signed.signature.location === "header" &&
    !Object.keys(signed.headers).some(
      (name) => name.toLowerCase() === signed.signature.name.toLowerCase(),
    )
  ) {
    throw new BayarLabError("INVALID_REQUEST", "Signer did not attach its signature header.");
  }
  if (!(signed.body instanceof Uint8Array)) {
    throw new BayarLabError("INVALID_REQUEST", "Signer must return a byte array body.");
  }
  if (signed.body.byteLength > MAX_REQUEST_BYTES) {
    throw new BayarLabError("REQUEST_TOO_LARGE", "Signed request body exceeds 1 MiB.");
  }
  return {
    targetUrl: url.toString(),
    method: "POST",
    headers: { ...signed.headers },
    body: new Uint8Array(signed.body),
    metadata: { ...event.metadata },
  };
}
