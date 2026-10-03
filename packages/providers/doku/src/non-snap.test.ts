import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import http from "node:http";

import { deliver, prepareSignedRequest } from "@bayarlab/engine";
import { describe, expect, it } from "vitest";

import {
  computeDokuNonSnapDigest,
  computeDokuNonSnapSignature,
  corruptDokuNonSnapSignature,
  DOKU_PRODUCT,
  dokuAdapter,
  manifest,
} from "./non-snap.js";

const secret = "bayarlab-local-doku-secret";
const clientId = "MCH-BAYARLAB-LOCAL";
const fixed = {
  orderId: "BL-DOKU-001",
  amount: 150_000,
  now: new Date("2026-09-28T00:00:00.000Z"),
  eventId: "22222222-2222-4222-8222-222222222222",
  transactionId: "11111111-1111-4111-8111-111111111111",
};
const fixture = JSON.parse(
  readFileSync(new URL("../fixtures/mandiri-va-success.json", import.meta.url), "utf8"),
) as Record<string, unknown>;

function verifySignature(body: Buffer, headers: http.IncomingHttpHeaders, path: string): boolean {
  const requestId = headers["request-id"];
  const timestamp = headers["request-timestamp"];
  const claimed = headers.signature;
  if (
    headers["client-id"] !== clientId ||
    typeof requestId !== "string" ||
    typeof timestamp !== "string" ||
    typeof claimed !== "string"
  )
    return false;
  const digest = createHash("sha256").update(body).digest("base64");
  const text = [
    `Client-Id:${clientId}`,
    `Request-Id:${requestId}`,
    `Request-Timestamp:${timestamp}`,
    `Request-Target:${path}`,
    `Digest:${digest}`,
  ].join("\n");
  const expected = `HMACSHA256=${createHmac("sha256", secret).update(text).digest("base64")}`;
  const actualBytes = Buffer.from(claimed);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

describe("DOKU Direct API non-SNAP Mandiri VA adapter", () => {
  it("publishes one non-SNAP product and one documented success scenario", () => {
    expect(manifest.products).toEqual([DOKU_PRODUCT]);
    expect(manifest.supportedScenarios).toEqual(["success"]);
    expect(manifest.knownDifferences?.join(" ")).toContain("SNAP requires separate");
    expect(dokuAdapter.listScenarios()).toMatchObject([{ state: "PAID" }]);
  });

  it("matches the Mandiri VA fixture with synthetic IDs", async () => {
    const event = await dokuAdapter.buildEvent({
      scenario: "success",
      product: DOKU_PRODUCT,
      ...fixed,
    });
    expect(event.body).toEqual(fixture);
    expect(event.metadata).toEqual({
      eventId: fixed.eventId,
      transactionId: fixed.transactionId,
      createdAt: "2026-09-28T00:00:00Z",
    });
    expect(await dokuAdapter.normalize(event.body)).toEqual({
      provider: "doku",
      state: "PAID",
      orderId: fixed.orderId,
      transactionId: fixed.transactionId,
    });
  });

  it("matches independent OpenSSL SHA-256 and HMAC-SHA256 vectors", () => {
    const body = Buffer.from('{"hello":"world"}', "utf8");
    expect(computeDokuNonSnapDigest(body)).toBe("k6I5cakU5erL8KjSUVTNownDwccvu5kU1Hxg88toFYg=");
    const components = {
      clientId,
      requestId: fixed.eventId,
      requestTimestamp: "2026-09-28T00:00:00Z",
      requestTarget: "/webhook/doku",
    };
    expect(computeDokuNonSnapSignature(body, components, secret)).toBe(
      "HMACSHA256=ePFtVvYNtbjASxjhQKr+r1czGs9WUTE2m+geqe6iZPE=",
    );
    expect(computeDokuNonSnapSignature(body, components, secret)).not.toBe(
      computeDokuNonSnapSignature(Buffer.from('{"hello":"WORLD"}'), components, secret),
    );
    expect(computeDokuNonSnapSignature(body, components, secret)).not.toBe(
      computeDokuNonSnapSignature(body, { ...components, requestTarget: "/other" }, secret),
    );
    expect(computeDokuNonSnapSignature(body, components, secret)).not.toBe(
      computeDokuNonSnapSignature(
        body,
        { ...components, requestTimestamp: "2026-09-28T00:00:01Z" },
        secret,
      ),
    );
    expect(computeDokuNonSnapSignature(body, components, secret)).not.toBe(
      computeDokuNonSnapSignature(body, components, "other-secret"),
    );
  });

  it("signs exact outgoing bytes and target path, without transmitting Digest or Request-Target", async () => {
    const event = await dokuAdapter.buildEvent({
      scenario: "success",
      product: DOKU_PRODUCT,
      ...fixed,
    });
    const signed = await prepareSignedRequest(
      dokuAdapter,
      event,
      "http://127.0.0.1:3000/payments/%2Fnotify",
      { secret, clientId },
    );
    expect(signed.headers["Client-Id"]).toBe(clientId);
    expect(signed.headers["Request-Id"]).toBe(fixed.eventId);
    expect(signed.headers["Request-Timestamp"]).toBe("2026-09-28T00:00:00Z");
    expect(signed.headers.Signature).toBe(
      computeDokuNonSnapSignature(
        signed.body,
        {
          clientId,
          requestId: fixed.eventId,
          requestTimestamp: "2026-09-28T00:00:00Z",
          requestTarget: "/payments/%2Fnotify",
        },
        secret,
      ),
    );
    expect(signed.headers).not.toHaveProperty("Request-Target");
    expect(signed.headers).not.toHaveProperty("Digest");
    expect(Buffer.from(signed.body).toString("utf8")).toBe(JSON.stringify(fixture));
    const invalid = corruptDokuNonSnapSignature(signed);
    expect(invalid.headers.Signature).toMatch(/^HMACSHA256=/);
    expect(invalid.headers.Signature).not.toBe(signed.headers.Signature);
    expect(invalid.body).toEqual(signed.body);
  });

  it("rejects unsupported states, missing credentials, and query-bearing targets", async () => {
    await expect(
      dokuAdapter.buildEvent({ scenario: "failed", product: DOKU_PRODUCT }),
    ).rejects.toThrow();
    await expect(
      dokuAdapter.buildEvent({ scenario: "success", product: "snap-mandiri-va" }),
    ).rejects.toThrow();
    await expect(dokuAdapter.validateConfig({ secret, clientId: "" })).resolves.toMatchObject({
      valid: false,
    });
    const event = await dokuAdapter.buildEvent({
      scenario: "success",
      product: DOKU_PRODUCT,
      ...fixed,
    });
    await expect(
      prepareSignedRequest(dokuAdapter, event, "http://127.0.0.1:3000/webhook?key=value", {
        secret,
        clientId,
      }),
    ).rejects.toThrow("no query string");
    await expect(
      prepareSignedRequest(dokuAdapter, event, "http://127.0.0.1:3000/webhook", { secret }),
    ).rejects.toThrow("Client-Id");
    await expect(
      dokuAdapter.normalize({ ...fixture, transaction: { status: "FAILED" } }),
    ).rejects.toThrow();
  });

  it("delivers valid, invalid and duplicate bytes to an independent local verifier", async () => {
    const seen: Array<{ body: string; requestId: string | undefined }> = [];
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const body = Buffer.concat(chunks);
        seen.push({
          body: body.toString("utf8"),
          requestId: req.headers["request-id"] as string | undefined,
        });
        res.writeHead(verifySignature(body, req.headers, req.url ?? "") ? 200 : 401).end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing test port.");
      const event = await dokuAdapter.buildEvent({
        scenario: "success",
        product: DOKU_PRODUCT,
        ...fixed,
      });
      const signed = await prepareSignedRequest(
        dokuAdapter,
        event,
        `http://127.0.0.1:${address.port}/payments/%2Fnotify`,
        { secret, clientId },
      );
      expect((await deliver(signed)).response?.status).toBe(200);
      expect((await deliver(signed)).response?.status).toBe(200);
      expect((await deliver(corruptDokuNonSnapSignature(signed))).response?.status).toBe(401);
      expect(
        (
          await deliver({
            ...signed,
            body: Buffer.from(
              Buffer.from(signed.body).toString("utf8").replace("BL-DOKU-001", "BL-DOKU-002"),
            ),
          })
        ).response?.status,
      ).toBe(401);
      expect(
        (
          await deliver({
            ...signed,
            targetUrl: `http://127.0.0.1:${address.port}/payments/other`,
          })
        ).response?.status,
      ).toBe(401);
      expect(
        (
          await deliver({
            ...signed,
            headers: { ...signed.headers, "Request-Timestamp": "2026-09-28T00:00:01Z" },
          })
        ).response?.status,
      ).toBe(401);
      const wrongSecret = await prepareSignedRequest(dokuAdapter, event, signed.targetUrl, {
        secret: "other-secret",
        clientId,
      });
      expect((await deliver(wrongSecret)).response?.status).toBe(401);
      expect(seen[0]).toEqual(seen[1]);
      expect(seen[2]).toEqual(seen[1]);
      expect(seen).toHaveLength(7);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
