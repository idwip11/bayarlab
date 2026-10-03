import { createHmac } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { BayarLabError, type ProviderEvent, type WireRequest } from "@bayarlab/core";
import type {
  ProviderAdapter,
  SignableRequest,
  SignedProviderEvent,
} from "@bayarlab/provider-contract";
import { afterEach, describe, expect, it } from "vitest";

import { deliver, MAX_RESPONSE_BYTES } from "./delivery.js";
import { formatDelivery, toDisplayResult } from "./format.js";
import { prepareSignedRequest } from "./request.js";
import { resolveTarget } from "./target.js";

const secret = "synthetic-test-secret";
const event: ProviderEvent = {
  provider: "fake",
  product: "synthetic",
  scenario: "paid",
  method: "POST",
  headers: {},
  body: { event_id: "event-1", amount: 150000, status: "paid" },
  metadata: { eventId: "event-1", transactionId: "tx-1", createdAt: "2026-09-21T00:00:00Z" },
};

const adapter: ProviderAdapter = {
  manifest: {
    provider: "fake",
    adapterVersion: "0.0.1",
    docsVerifiedAt: "2026-09-21",
    products: ["synthetic"],
  },
  listScenarios: () => [{ id: "paid", label: "Paid", product: "synthetic", state: "PAID" }],
  buildEvent: async () => event,
  validateConfig: async () => ({ valid: true, errors: [] }),
  sign: async (request: SignableRequest): Promise<SignedProviderEvent> => ({
    headers: {
      ...request.headers,
      "x-test-signature": createHmac("sha256", secret)
        .update(request.pathAndQuery)
        .update(".")
        .update(request.body)
        .digest("hex"),
    },
    body: request.body,
    signature: { location: "header", name: "x-test-signature" },
  }),
};

const servers: Server[] = [];

async function localServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<{ url: string; server: Server }> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return { url: `http://127.0.0.1:${port}/webhook?channel=test`, server };
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});

async function signed(url: string): Promise<WireRequest> {
  return prepareSignedRequest(adapter, event, url, { secret });
}

describe("delivery engine", () => {
  it("sends the signed bytes to localhost and preserves them across replay", async () => {
    const received: Array<{ path: string; body: string; signature: string }> = [];
    const { url } = await localServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        received.push({
          path: req.url ?? "",
          body: Buffer.concat(chunks).toString("utf8"),
          signature: String(req.headers["x-test-signature"]),
        });
        res.writeHead(200, { "content-type": "application/json" });
        res.end('{"acknowledged":true}');
      });
    });
    const request = await signed(url);
    const first = await deliver(request);
    const replay = await deliver(request);

    expect(first.response?.status).toBe(200);
    expect(first.response?.body).toBe('{"acknowledged":true}');
    expect(first.requestId).not.toBe(replay.requestId);
    expect(received).toHaveLength(2);
    expect(received[0]?.body).toBe(received[1]?.body);
    expect(received[0]?.signature).toBe(received[1]?.signature);
    const expected = createHmac("sha256", secret)
      .update("/webhook?channel=test")
      .update(".")
      .update(Buffer.from(request.body))
      .digest("hex");
    expect(received[0]?.signature).toBe(expected);
    expect(received[0]?.path).toBe("/webhook?channel=test");
    expect(first.request.metadata.eventId).toBe("event-1");
  });

  it("captures rejection, server failure, and redirects without following", async () => {
    let redirected = false;
    const { url } = await localServer((req, res) => {
      if (req.url?.startsWith("/redirected")) redirected = true;
      if (req.url?.startsWith("/reject")) {
        res.writeHead(401);
        res.end("bad signature");
      } else if (req.url?.startsWith("/fail")) {
        res.writeHead(503);
        res.end("temporarily unavailable");
      } else {
        res.writeHead(307, { location: "/redirected" });
        res.end();
      }
    });
    const base = new URL(url).origin;
    const [reject, failure, redirect] = await Promise.all([
      deliver(await signed(`${base}/reject`)),
      deliver(await signed(`${base}/fail`)),
      deliver(await signed(`${base}/redirect`)),
    ]);
    expect(reject.response?.status).toBe(401);
    expect(reject.response?.body).toBe("bad signature");
    expect(failure.response?.status).toBe(503);
    expect(redirect.response?.status).toBe(307);
    expect(redirect.response?.headers.location).toBe("/redirected");
    expect(redirected).toBe(false);
  });

  it("reports total timeout and limits captured response bytes", async () => {
    const { url } = await localServer((req, res) => {
      if (req.url?.startsWith("/slow")) return;
      res.writeHead(200);
      res.end("x".repeat(MAX_RESPONSE_BYTES + 100));
    });
    const base = new URL(url).origin;
    const timeout = await deliver(await signed(`${base}/slow`), { timeoutMs: 30 });
    expect(timeout.error?.code).toBe("TIMEOUT");

    const large = await deliver(await signed(`${base}/large`));
    expect(large.response?.status).toBe(200);
    expect(large.response?.truncated).toBe(true);
    expect(Buffer.byteLength(large.response?.body ?? "")).toBe(MAX_RESPONSE_BYTES);
  });

  it("returns a transport error for a refused connection", async () => {
    const { url, server } = await localServer((_req, res) => res.end());
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const result = await deliver(await signed(url), { timeoutMs: 1000 });
    expect(result.error?.code).toBe("NETWORK_ERROR");
  });

  it("rejects invalid targets, public destinations and oversized requests before sending", async () => {
    await expect(resolveTarget("https://8.8.8.8/webhook")).rejects.toMatchObject({
      code: "REMOTE_TARGET_NOT_ALLOWED",
    });
    await expect(resolveTarget("http://169.254.169.254/latest", true)).rejects.toMatchObject({
      code: "UNSAFE_TARGET",
    });
    await expect(resolveTarget("http://100.100.100.200/latest", true)).rejects.toMatchObject({
      code: "UNSAFE_TARGET",
    });
    await expect(resolveTarget("file:///tmp/whatever")).rejects.toBeInstanceOf(BayarLabError);
    await expect(resolveTarget("http:127.0.0.1")).rejects.toMatchObject({
      code: "INVALID_TARGET",
    });
    await expect(
      prepareSignedRequest(
        adapter,
        { ...event, body: { huge: "x".repeat(1024 * 1024) } },
        "http://127.0.0.1:3000/webhook",
        { secret },
      ),
    ).rejects.toMatchObject({ code: "REQUEST_TOO_LARGE" });
  });

  it("redacts signatures and sensitive fields from text and JSON output", async () => {
    const { url } = await localServer((_req, res) => {
      res.setHeader("set-cookie", "session=secret");
      res.end(`{"apiKey":"hidden","echo":"${secret}"}`);
    });
    const request = await signed(`${url}&token=hidden`);
    const result = await deliver(request);
    const display = toDisplayResult(result, [secret]);
    expect(display.request.headers["x-test-signature"]).toBe("[REDACTED]");
    expect(display.targetUrl).not.toContain("hidden");
    expect(formatDelivery(result, "json", [secret])).not.toContain('"apiKey":"hidden"');
    expect(formatDelivery(result, "json", [secret])).not.toContain(secret);
    expect(formatDelivery(result, "text", [secret])).not.toContain(secret);
  });
});
