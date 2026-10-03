import { describe, expect, it } from "vitest";

import { loadRuntimeConfig } from "./config.js";
import { SessionHistory } from "./history.js";

describe("runtime configuration", () => {
  it("uses safe defaults and does not require persisted configuration", () => {
    const config = loadRuntimeConfig({});
    expect(config.amount).toBe(150_000);
    expect(config.timeoutMs).toBe(15_000);
    expect(config.target).toBeUndefined();
    expect(config.sources.midtransSecret).toBe("default");
    expect(config.sources.xenditCallbackToken).toBe("default");
    expect(config.sources.dokuClientId).toBe("default");
    expect(config.sources.dokuSecret).toBe("default");
  });

  it("loads environment values with documented precedence inputs", () => {
    const config = loadRuntimeConfig({
      BAYARLAB_TARGET: "http://127.0.0.1:3010/webhook",
      BAYARLAB_AMOUNT: "200000",
      BAYARLAB_TIMEOUT_MS: "5000",
      BAYARLAB_MIDTRANS_TEST_KEY: "test-only-key",
      BAYARLAB_XENDIT_CALLBACK_TOKEN: "test-only-token",
      BAYARLAB_DOKU_CLIENT_ID: "MCH-TEST-001",
      BAYARLAB_DOKU_SECRET: "test-doku-secret",
    });
    expect(config).toMatchObject({
      target: "http://127.0.0.1:3010/webhook",
      amount: 200_000,
      timeoutMs: 5000,
      midtransSecret: "test-only-key",
      xenditCallbackToken: "test-only-token",
      dokuClientId: "MCH-TEST-001",
      dokuSecret: "test-doku-secret",
    });
    expect(config.sources).toEqual({
      amount: "environment",
      target: "environment",
      timeoutMs: "environment",
      midtransSecret: "environment",
      xenditCallbackToken: "environment",
      dokuClientId: "environment",
      dokuSecret: "environment",
    });
  });
});

describe("session history", () => {
  it("retains only the most recent bounded records", () => {
    const history = new SessionHistory(2);
    for (const id of ["one", "two", "three"]) {
      history.add({
        id,
        provider: "midtrans",
        scenario: "settlement",
        request: {} as never,
        result: {} as never,
      });
    }
    expect(history.list().map((entry) => entry.id)).toEqual(["two", "three"]);
  });
});
