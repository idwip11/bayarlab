import { createHash } from "node:crypto";
import { once } from "node:events";
import http from "node:http";
import type { WireRequest } from "@bayarlab/core";
import { describe, expect, it } from "vitest";
import { assertResponse, mutateRequest, runReliabilityScenario } from "./chaos.js";
import { toDisplayResult } from "./format.js";

const key = "local-test-key";
function request(target: string, status = "settlement"): WireRequest {
  const code = status === "pending" ? "201" : "200";
  const body = {
    order_id: "BL-1",
    gross_amount: "150000.00",
    status_code: code,
    transaction_status: status,
    transaction_id: "transaction-1",
    signature_key: createHash("sha512").update(`BL-1${code}150000.00${key}`).digest("hex"),
  };
  return {
    targetUrl: target,
    method: "POST",
    headers: { "content-type": "application/json" },
    body: Buffer.from(JSON.stringify(body)),
    metadata: {
      eventId: status,
      transactionId: "transaction-1",
      createdAt: "2026-09-23T00:00:00Z",
    },
  };
}
function json(value: WireRequest) {
  return JSON.parse(Buffer.from(value.body).toString());
}

describe("chaos mutations", () => {
  it("mutates signed fields, types and extras without changing the source or re-signing", () => {
    const source = request("http://127.0.0.1");
    const changed = mutateRequest(source, {
      removeFields: ["status_code"],
      setFields: { gross_amount: 99, extra: { test: true } },
    });
    expect(json(changed)).toMatchObject({
      gross_amount: 99,
      extra: { test: true },
      signature_key: json(source).signature_key,
    });
    expect(json(changed)).not.toHaveProperty("status_code");
    expect(json(source)).toMatchObject({ status_code: "200", gross_amount: "150000.00" });
  });
  it("supports body/header signature removal and corruption", () => {
    const source = request("http://127.0.0.1");
    expect(
      json(
        mutateRequest(source, {
          signature: { location: "body", name: "signature_key", mode: "missing" },
        }),
      ),
    ).not.toHaveProperty("signature_key");
    expect(
      json(
        mutateRequest(source, {
          signature: { location: "body", name: "signature_key", mode: "invalid" },
        }),
      ).signature_key,
    ).not.toBe(json(source).signature_key);
    const header = { ...source, headers: { "X-Signature": "abc" } };
    expect(
      mutateRequest(header, {
        signature: { location: "header", name: "x-signature", mode: "missing" },
      }).headers,
    ).toEqual({});
    expect(header.headers["X-Signature"]).toBe("abc");
  });
  it("rejects ambiguous fields and oversize bodies", () => {
    const source = request("http://127.0.0.1");
    expect(() => mutateRequest(source, { removeFields: ["__proto__"] })).toThrow();
    expect(() => mutateRequest(source, { setFields: { large: "x".repeat(1024 * 1024) } })).toThrow(
      "1 MiB",
    );
  });
  it("redacts malformed requests and signatures reflected by a plain-text receiver", () => {
    const raw = request("http://127.0.0.1");
    const mutated = mutateRequest(raw, { malformedBody: true });
    expect(() => json(mutated)).toThrow();
    const display = toDisplayResult(
      {
        requestId: "1",
        request: mutated,
        targetUrl: mutated.targetUrl,
        durationMs: 0,
        response: {
          status: 400,
          headers: {},
          body: Buffer.from(mutated.body).toString(),
          truncated: false,
        },
      },
      [key],
    );
    expect(JSON.stringify(display)).not.toContain(json(raw).signature_key);
  });
});

describe("reliability runner", () => {
  it("delays, duplicates, reverses lifecycle, and reports receiver rejections", async () => {
    const received: string[] = [];
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString();
        received.push(raw);
        try {
          const body = JSON.parse(raw);
          const signature = createHash("sha512")
            .update(body.order_id + body.status_code + body.gross_amount + key)
            .digest("hex");
          res.writeHead(signature === body.signature_key ? 200 : 401).end("ack");
        } catch {
          res.writeHead(400).end("malformed");
        }
      });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("No receiver");
      const target = `http://127.0.0.1:${address.port}`;
      const started = Date.now();
      const report = await runReliabilityScenario(
        [
          { name: "pending", request: request(target, "pending") },
          { name: "settlement", request: request(target), copies: 2, delayMs: 15 },
        ],
        { reverse: true },
      );
      expect(report.passed).toBe(true);
      expect(Date.now() - started).toBeGreaterThanOrEqual(30);
      expect(received.map((raw) => JSON.parse(raw).transaction_status)).toEqual([
        "settlement",
        "settlement",
        "pending",
      ]);
      expect(received[0]).toBe(received[1]);
      expect(new Set(report.attempts.map((item) => item.result.requestId)).size).toBe(3);
      const negative = await runReliabilityScenario([
        {
          name: "invalid",
          request: request(target),
          mutation: { signature: { location: "body", name: "signature_key", mode: "invalid" } },
          expect: { status: 401, bodyIncludes: "ack" },
        },
        {
          name: "missing",
          request: request(target),
          mutation: { signature: { location: "body", name: "signature_key", mode: "missing" } },
          expect: { status: 401 },
        },
        {
          name: "amount",
          request: request(target),
          mutation: { setFields: { gross_amount: "1.00" } },
          expect: { status: 401 },
        },
        {
          name: "malformed",
          request: request(target),
          mutation: { malformedBody: true },
          expect: { status: 400 },
        },
      ]);
      expect(negative.passed).toBe(true);
      const mismatch = await runReliabilityScenario([
        { name: "false rejection", request: request(target), expect: { status: 401 } },
      ]);
      expect(mismatch.passed).toBe(false);
      const before = received.length;
      await expect(
        runReliabilityScenario([
          { name: "first", request: request(target) },
          { name: "invalid later", request: request(target), copies: 0 },
        ]),
      ).rejects.toThrow();
      expect(received).toHaveLength(before);
      await expect(
        runReliabilityScenario([
          { name: "first", request: request(target) },
          { name: "bad headers", request: { ...request(target), headers: { host: "override" } } },
        ]),
      ).rejects.toThrow();
      expect(received).toHaveLength(before);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it("distinguishes expected timeouts and does not pass a truncated body assertion", () => {
    const base = {
      requestId: "1",
      request: request("http://127.0.0.1"),
      targetUrl: "http://127.0.0.1",
      durationMs: 50,
    };
    expect(
      assertResponse(
        { ...base, error: { code: "TIMEOUT", message: "timeout" } },
        { error: "TIMEOUT" },
      ),
    ).toEqual([]);
    expect(
      assertResponse(
        { ...base, response: { status: 200, headers: {}, body: "ok", truncated: true } },
        { bodyIncludes: "ok" },
      ),
    ).not.toEqual([]);
    expect(() => assertResponse(base, { error: "TIMEOUT", status: 200 })).toThrow();
  });
});
