import { randomUUID } from "node:crypto";
import http from "node:http";
import https from "node:https";
import { performance } from "node:perf_hooks";

import { BayarLabError, type DeliveryResult, type WireRequest } from "@bayarlab/core";

import { MAX_REQUEST_BYTES, validateHeaders } from "./request.js";
import { resolveTarget } from "./target.js";

export const MAX_RESPONSE_BYTES = 1024 * 1024;
export const DEFAULT_TIMEOUT_MS = 15_000;

export interface DeliveryOptions {
  allowRemoteTarget?: boolean;
  timeoutMs?: number;
  requestId?: string;
}

function responseHeaders(headers: http.IncomingHttpHeaders): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined) result[name] = Array.isArray(value) ? value.join(", ") : value;
  }
  return result;
}

export async function deliver(
  wireRequest: WireRequest,
  options: DeliveryOptions = {},
): Promise<DeliveryResult> {
  if (wireRequest.method !== "POST" || !(wireRequest.body instanceof Uint8Array)) {
    throw new BayarLabError("INVALID_REQUEST", "Delivery requires a POST request with byte body.");
  }
  validateHeaders(wireRequest.headers);
  if (wireRequest.body.byteLength > MAX_REQUEST_BYTES) {
    throw new BayarLabError("REQUEST_TOO_LARGE", "Request body exceeds 1 MiB.");
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
    throw new BayarLabError("INVALID_REQUEST", "Timeout must be 1–120000 milliseconds.");
  }
  const target = await resolveTarget(wireRequest.targetUrl, options.allowRemoteTarget);
  const requestId = options.requestId ?? randomUUID();
  const started = performance.now();
  const requestBody = Buffer.from(wireRequest.body);
  const safeRequest: WireRequest = {
    ...wireRequest,
    headers: { ...wireRequest.headers },
    body: new Uint8Array(requestBody),
    metadata: { ...wireRequest.metadata },
  };

  return await new Promise<DeliveryResult>((resolve) => {
    let finished = false;
    let timer: NodeJS.Timeout;
    const finish = (partial: Pick<DeliveryResult, "response" | "error">) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({
        requestId,
        targetUrl: wireRequest.targetUrl,
        request: safeRequest,
        durationMs: Math.round(performance.now() - started),
        ...partial,
      });
    };
    const client = target.url.protocol === "https:" ? https : http;
    const req = client.request(
      {
        protocol: target.url.protocol,
        hostname: target.address,
        port: target.url.port || (target.url.protocol === "https:" ? 443 : 80),
        path: `${target.url.pathname}${target.url.search}`,
        method: "POST",
        servername: target.url.hostname.replace(/^\[|\]$/g, ""),
        headers: {
          ...wireRequest.headers,
          host: target.url.host,
          "content-length": requestBody.byteLength,
        },
        agent: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let byteCount = 0;
        const response = (truncated: boolean) => ({
          status: res.statusCode ?? 0,
          headers: responseHeaders(res.headers),
          body: Buffer.concat(chunks).toString("utf8"),
          truncated,
        });
        res.on("data", (chunk: Buffer) => {
          const remaining = MAX_RESPONSE_BYTES - byteCount;
          if (chunk.byteLength > remaining) {
            if (remaining > 0) chunks.push(chunk.subarray(0, remaining));
            finish({ response: response(true) });
            res.destroy();
          } else {
            chunks.push(chunk);
            byteCount += chunk.byteLength;
          }
        });
        res.on("end", () => finish({ response: response(false) }));
        res.on("error", (error) => {
          finish({
            error: { code: "NETWORK_ERROR", message: error.message },
          });
        });
      },
    );
    timer = setTimeout(() => {
      finish({
        error: { code: "TIMEOUT", message: `No complete response within ${timeoutMs} ms.` },
      });
      req.destroy();
    }, timeoutMs);
    req.on("error", (error) => {
      finish({ error: { code: "NETWORK_ERROR", message: error.message } });
    });
    req.end(requestBody);
  });
}
