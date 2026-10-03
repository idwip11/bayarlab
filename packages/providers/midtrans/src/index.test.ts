import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import http from "node:http";

import { deliver, prepareSignedRequest } from "@bayarlab/engine";
import { describe, expect, it } from "vitest";

import {
  computeMidtransSignature,
  corruptMidtransSignature,
  manifest,
  midtransAdapter,
} from "./index.js";

const secret = "bayarlab-local-test-key";
const fixtures = JSON.parse(
  readFileSync(new URL("../fixtures/notifications.json", import.meta.url), "utf8"),
) as Record<string, Record<string, unknown>>;
const fixed = {
  orderId: "BL-TEST-001",
  amount: 150_000,
  now: new Date("2026-09-21T00:00:00.000Z"),
  eventId: "bl-event-001",
  transactionId: "11111111-1111-4111-8111-111111111111",
};

describe("Midtrans classic notification adapter", () => {
  it.each(["challenge", "deny", "unknown", undefined])(
    "rejects capture fraud status %s rather than returning PAID",
    async (fraud_status) => {
      await expect(
        midtransAdapter.normalize({ ...fixtures.capture, fraud_status }),
      ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    },
  );

  it("rejects incompatible payment types", async () => {
    await expect(
      midtransAdapter.normalize({ ...fixtures.capture, payment_type: "bank_transfer" }),
    ).rejects.toThrow("Unsupported Midtrans");
    await expect(
      midtransAdapter.normalize({ ...fixtures.settlement, payment_type: "credit_card" }),
    ).rejects.toThrow("Unsupported Midtrans");
  });
  it("publishes scoped and traceable metadata", () => {
    expect(manifest.provider).toBe("midtrans");
    expect(manifest.products).toEqual(["bni-va", "credit-card"]);
    expect(manifest.supportedScenarios).toHaveLength(6);
    expect(manifest.documentationUrls?.length).toBeGreaterThan(0);
    expect(manifest.knownDifferences?.join(" ")).toContain("composed");
  });

  it.each(midtransAdapter.listScenarios())(
    "matches the $id golden fixture",
    async ({ id, product, state }) => {
      const event = await midtransAdapter.buildEvent({ scenario: id, product, ...fixed });
      expect(event.body).toEqual(fixtures[id]);
      expect(event.metadata).toEqual({
        eventId: fixed.eventId,
        transactionId: fixed.transactionId,
        createdAt: "2026-09-21T00:00:00.000Z",
      });
      expect(await midtransAdapter.normalize(event.body)).toMatchObject({
        state,
        orderId: fixed.orderId,
        transactionId: fixed.transactionId,
      });
    },
  );

  it("matches a fixed SHA-512 vector computed independently with shasum", () => {
    expect(computeMidtransSignature("BL-TEST-001", "200", "150000.00", secret)).toBe(
      "0684b319e3365f5b1b87adf9d756379c08d17168cf1a7c3299a658c57463c237fab6ee2521450bd4960beb8ee54a8764a3b56bc299eae46b3621490c09d3d357",
    );
    expect(computeMidtransSignature("BL-TEST-001", "200", "150000.00", secret)).not.toBe(
      computeMidtransSignature("BL-TEST-001", "200", "150000", secret),
    );
    expect(
      computeMidtransSignature(
        "1111",
        "200",
        "100000.00",
        "askvnoibnosifnboseofinbofinfgbiufglnbfg",
      ),
    ).toBe(
      "edc076b21793ebe3e17926350f5b8ae67d902fe657b3d0aa31b932d5c127e2375d308a2bc94f3265ac2d80a1f181a79b997ac178a236fcff35af263fc4d4c231",
    );
  });

  it("signs the serialized body and corrupts only the signature", async () => {
    const event = await midtransAdapter.buildEvent({
      scenario: "settlement",
      product: "bni-va",
      ...fixed,
    });
    const signed = await prepareSignedRequest(
      midtransAdapter,
      event,
      "http://127.0.0.1:3000/webhook",
      { secret },
    );
    const body = JSON.parse(Buffer.from(signed.body).toString("utf8")) as Record<string, unknown>;
    expect(body.signature_key).toBe(
      computeMidtransSignature(
        body.order_id as string,
        body.status_code as string,
        body.gross_amount as string,
        secret,
      ),
    );
    expect(signed.headers).not.toHaveProperty("x-midtrans-signature");
    const invalid = corruptMidtransSignature(signed);
    const invalidBody = JSON.parse(Buffer.from(invalid.body).toString("utf8")) as Record<
      string,
      unknown
    >;
    expect(invalidBody.signature_key).not.toBe(body.signature_key);
    expect({ ...invalidBody, signature_key: body.signature_key }).toEqual(body);
    expect(Buffer.from(signed.body).toString("utf8")).toContain(body.signature_key as string);
  });

  it("rejects unsupported combinations and malformed data", async () => {
    await expect(
      midtransAdapter.buildEvent({ scenario: "deny", product: "bni-va" }),
    ).rejects.toThrow();
    await expect(
      midtransAdapter.buildEvent({ scenario: "pending", product: "bni-va", amount: 1.5 }),
    ).rejects.toThrow();
    await expect(
      midtransAdapter.buildEvent({ scenario: "pending", product: "bni-va", orderId: "bad id" }),
    ).rejects.toThrow();
    await expect(midtransAdapter.validateConfig({ secret: "" })).resolves.toMatchObject({
      valid: false,
    });
  });

  it("delivers valid, invalid, and duplicate bytes to a local receiver", async () => {
    const seen: string[] = [];
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, string>;
        seen.push(Buffer.concat(chunks).toString("utf8"));
        const expected = createHash("sha512")
          .update(`${body.order_id}${body.status_code}${body.gross_amount}${secret}`)
          .digest("hex");
        res.writeHead(body.signature_key === expected ? 200 : 401);
        res.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing test port.");
      const target = `http://127.0.0.1:${address.port}/webhook`;
      const event = await midtransAdapter.buildEvent({
        scenario: "settlement",
        product: "bni-va",
        ...fixed,
      });
      const signed = await prepareSignedRequest(midtransAdapter, event, target, { secret });
      expect((await deliver(signed)).response?.status).toBe(200);
      expect((await deliver(signed)).response?.status).toBe(200);
      expect((await deliver(corruptMidtransSignature(signed))).response?.status).toBe(401);
      expect(seen[0]).toBe(seen[1]);
      expect(seen[2]).not.toBe(seen[1]);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
