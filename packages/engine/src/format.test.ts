import type { DeliveryResult } from "@bayarlab/core";
import { describe, expect, it } from "vitest";
import { redactTargetUrl, toDisplayResult } from "./format.js";

const secret = 'RC-synthetic-quote"value\\with\nnewline';
const signature = 'RC-signature"\\value';

function result(
  body: string,
  requestBody = JSON.stringify({ signature_key: signature }),
): DeliveryResult {
  return {
    requestId: "attempt-1",
    targetUrl: `http://127.0.0.1/${encodeURIComponent(secret)}?note=${encodeURIComponent(secret)}&token=hidden`,
    request: {
      targetUrl: "http://127.0.0.1/",
      method: "POST",
      headers: {
        Signature: signature,
        "x-callback-token": "RC-invalid-token",
        "x-echo": signature,
      },
      body: Buffer.from(requestBody),
      metadata: { eventId: "event-1", createdAt: "2026-10-03T00:00:00Z" },
    },
    response: {
      status: 200,
      headers: { "x-echo": signature, "x-note": "RC-invalid-token" },
      body,
      truncated: false,
    },
    error: { code: "NETWORK_ERROR", message: `${secret} ${signature} RC-invalid-token` },
    durationMs: 1,
  };
}

describe("secret-safe display", () => {
  it("fails closed if extreme JSON nesting prevents safe redaction", () => {
    const body = `${"[".repeat(20_000)}${JSON.stringify(secret)}${"]".repeat(20_000)}`;
    const safe = toDisplayResult(result(body, body), [secret]);
    expect(safe.response?.body).toBe("[JSON body omitted: redaction failed]");
    expect(safe.request.body).toBe("[JSON body omitted: redaction failed]");
  });
  it("redacts decoded nested JSON strings, keys, reflected headers and errors without changing wire bytes", () => {
    const original = result(
      JSON.stringify({ echo: secret, nested: [signature, { [secret]: secret }], token: "other" }),
    );
    const bytes = Buffer.from(original.request.body);
    const safe = toDisplayResult(original, [secret]);
    expect(JSON.parse(safe.response?.body ?? "")).toEqual({
      echo: "[REDACTED]",
      nested: ["[REDACTED]", { "[REDACTED]": "[REDACTED]" }],
      token: "[REDACTED]",
    });
    expect(safe.response?.headers).toEqual({ "x-echo": "[REDACTED]", "x-note": "[REDACTED]" });
    expect(safe.request.headers["x-echo"]).toBe("[REDACTED]");
    expect(safe.error?.message).toBe("[REDACTED] [REDACTED] [REDACTED]");
    expect(decodeURIComponent(safe.targetUrl)).not.toContain(secret);
    expect(Buffer.from(original.request.body)).toEqual(bytes);
    expect(original.response?.body).toContain(JSON.stringify(secret));
  });

  it("masks plaintext reflections from a malformed JSON request", () => {
    const safe = toDisplayResult(
      result(`${signature} RC-invalid-token`, `{"signature_key":${JSON.stringify(signature)},`),
      [],
    );
    expect(safe.request.body).toBe("[Non-JSON request body omitted]");
    expect(safe.response?.body).toBe("[REDACTED] [REDACTED]");
  });

  it("masks encoded credentials and repeated sensitive query parameters", () => {
    const url = new URL(
      redactTargetUrl(
        `http://user:pass@localhost/${encodeURIComponent(secret)}?note=${encodeURIComponent(secret)}&token=one&token=two`,
        [secret],
      ),
    );
    expect(decodeURIComponent(url.pathname)).toBe("/[REDACTED]");
    expect(url.searchParams.get("note")).toBe("[REDACTED]");
    expect(url.searchParams.getAll("token")).toEqual(["[REDACTED]", "[REDACTED]"]);
    expect(decodeURIComponent(url.username)).toBe("[REDACTED]");
    expect(redactTargetUrl("not a url")).toBe("[Invalid target URL omitted]");
  });
});
