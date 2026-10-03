import { describe, expect, it } from "vitest";

import { demoAdapter } from "./index.js";

describe("synthetic demo adapter", () => {
  it("builds deterministic data from injected clock and IDs", async () => {
    const input = {
      scenario: "paid",
      product: "synthetic",
      eventId: "event-1",
      transactionId: "tx-1",
      now: new Date("2026-09-21T00:00:00.000Z"),
      orderId: "BL-DEMO-001",
      amount: 150000,
    };
    const first = await demoAdapter.buildEvent(input);
    const second = await demoAdapter.buildEvent(input);
    expect(first).toEqual(second);
    expect(first.metadata.eventId).toBe("event-1");
  });

  it("matches a fixed HMAC vector for the exact path and JSON bytes", async () => {
    const body = Buffer.from(
      '{"event_id":"event-1","transaction_id":"tx-1","order_id":"BL-DEMO-001","amount":150000,"status":"paid","created_at":"2026-09-21T00:00:00.000Z"}',
    );
    const signed = await demoAdapter.sign(
      {
        method: "POST",
        targetUrl: "http://127.0.0.1:3000/webhook?channel=test",
        pathAndQuery: "/webhook?channel=test",
        headers: { "content-type": "application/json" },
        body,
        metadata: {
          eventId: "event-1",
          transactionId: "tx-1",
          createdAt: "2026-09-21T00:00:00.000Z",
        },
      },
      { secret: "synthetic-test-secret" },
    );
    expect(signed.headers["x-bayarlab-signature"]).toBe(
      "b274ce98f6426801bc09dc5017117f3da5edc47986ab03353d43dac93219aac9",
    );
    expect(Buffer.from(signed.body)).toEqual(body);
  });
});
