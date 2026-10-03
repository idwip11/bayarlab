import { readFileSync } from "node:fs";
import http from "node:http";

import { deliver, prepareSignedRequest } from "@bayarlab/engine";
import { describe, expect, it } from "vitest";

import {
  corruptXenditCallbackToken,
  manifest,
  XENDIT_CALLBACK_HEADER,
  XENDIT_PRODUCT,
  xenditAdapter,
} from "./index.js";

const token = "local-xendit-test-token";
const fixtures = JSON.parse(
  readFileSync(new URL("../fixtures/notifications.json", import.meta.url), "utf8"),
) as Record<string, Record<string, unknown>>;
const fixed = {
  orderId: "BL-XENDIT-001",
  amount: 150_000,
  now: new Date("2026-09-23T00:00:00.000Z"),
  eventId: "22222222-2222-4222-8222-222222222222",
  transactionId: "11111111-1111-4111-8111-111111111111",
};

describe("Xendit Payments API v3 DANA adapter", () => {
  it("publishes a narrowly scoped manifest and composed failure provenance", () => {
    expect(manifest.products).toEqual([XENDIT_PRODUCT]);
    expect(manifest.supportedScenarios).toEqual(["capture", "failure"]);
    expect(manifest.knownDifferences?.join(" ")).toContain("composed");
    expect(manifest.documentationUrls).toContain(
      "https://docs.xendit.co/apidocs/payment-webhook-notification",
    );
  });

  it.each(xenditAdapter.listScenarios())(
    "matches $id fixture and normalized state",
    async ({ id, product, state }) => {
      const event = await xenditAdapter.buildEvent({ scenario: id, product, ...fixed });
      expect(event.body).toEqual(fixtures[id]);
      expect(event.metadata).toEqual({
        eventId: fixed.eventId,
        transactionId: fixed.transactionId,
        createdAt: fixed.now.toISOString(),
      });
      expect(await xenditAdapter.normalize(event.body)).toEqual({
        provider: "xendit",
        state,
        orderId: fixed.orderId,
        transactionId: `py-${fixed.transactionId}`,
      });
    },
  );

  it("uses an exact callback-token header, not a body HMAC", async () => {
    const event = await xenditAdapter.buildEvent({
      scenario: "capture",
      product: XENDIT_PRODUCT,
      ...fixed,
    });
    const signed = await prepareSignedRequest(
      xenditAdapter,
      event,
      "http://127.0.0.1:3000/webhook",
      { secret: token },
    );
    expect(signed.headers[XENDIT_CALLBACK_HEADER]).toBe(token);
    expect(Buffer.from(signed.body).toString("utf8")).toBe(JSON.stringify(fixtures.capture));
    expect(signed.headers).not.toHaveProperty("api-version");
    expect(signed.headers).not.toHaveProperty("authorization");
    const invalid = corruptXenditCallbackToken(signed);
    expect(invalid.headers[XENDIT_CALLBACK_HEADER]).not.toBe(token);
    expect(invalid.headers[XENDIT_CALLBACK_HEADER]).toHaveLength(token.length);
    expect(invalid.body).toEqual(signed.body);
    expect(signed.headers[XENDIT_CALLBACK_HEADER]).toBe(token);
  });

  it("rejects unsupported families, invalid configuration and conflicting statuses", async () => {
    await expect(
      xenditAdapter.buildEvent({ scenario: "capture", product: "legacy-ewallet" }),
    ).rejects.toThrow();
    await expect(
      xenditAdapter.buildEvent({ scenario: "pending", product: XENDIT_PRODUCT }),
    ).rejects.toThrow();
    await expect(
      xenditAdapter.buildEvent({ scenario: "failure", product: XENDIT_PRODUCT, amount: 1.5 }),
    ).rejects.toThrow();
    await expect(xenditAdapter.validateConfig({ secret: "" })).resolves.toMatchObject({
      valid: false,
    });
    await expect(xenditAdapter.validateConfig({ secret: "bad\nheader" })).resolves.toMatchObject({
      valid: false,
    });
    await expect(
      xenditAdapter.normalize({
        ...fixtures.capture,
        data: { ...(fixtures.capture?.data as object), status: "FAILED" },
      }),
    ).rejects.toThrow();
  });

  it("delivers accepted, rejected and byte-identical duplicate requests to a local receiver", async () => {
    const seen: string[] = [];
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        seen.push(Buffer.concat(chunks).toString("utf8"));
        res.writeHead(req.headers[XENDIT_CALLBACK_HEADER] === token ? 200 : 401);
        res.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing test port.");
      const event = await xenditAdapter.buildEvent({
        scenario: "capture",
        product: XENDIT_PRODUCT,
        ...fixed,
      });
      const signed = await prepareSignedRequest(
        xenditAdapter,
        event,
        `http://127.0.0.1:${address.port}/webhook`,
        { secret: token },
      );
      expect((await deliver(signed)).response?.status).toBe(200);
      expect((await deliver(signed)).response?.status).toBe(200);
      expect((await deliver(corruptXenditCallbackToken(signed))).response?.status).toBe(401);
      expect(seen).toHaveLength(3);
      expect(seen[0]).toBe(seen[1]);
      expect(seen[1]).toBe(seen[2]);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
