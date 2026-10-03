import { describe, expect, it } from "vitest";

import { scenarioFileSchema } from "./schema.js";

function validScenario(overrides: Record<string, unknown> = {}): unknown {
  return {
    version: 1,
    provider: "midtrans",
    target: "http://localhost:3000/webhook",
    steps: [{ event: "settlement" }],
    ...overrides,
  };
}

describe("scenarioFileSchema", () => {
  it.each([
    { event: "settlement", exepct: { status: 401 } },
    { event: "settlement", optoins: { duplicate: true } },
    { wait: 0, extra: true },
    { event: "settlement", wait: 0 },
  ])("rejects unknown or ambiguous step fields: %j", (step) => {
    const result = scenarioFileSchema.safeParse(validScenario({ steps: [step] }));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(["steps", 0]);
  });
  it("accepts a minimal valid scenario", () => {
    const result = scenarioFileSchema.safeParse(validScenario());
    expect(result.success).toBe(true);
  });

  it("accepts a full scenario with all optional fields", () => {
    const result = scenarioFileSchema.safeParse(
      validScenario({
        variables: { order_id: "BL-001", amount: 150000, product: "bni-va" },
        deterministic: { seed: "ci-run-1", timestamp: "2026-01-15T10:00:00Z" },
        steps: [
          { event: "pending", expect: { status: 200 } },
          { wait: 1000 },
          { event: "settlement", expect: { status: 200, body_includes: "ok" } },
          {
            event: "settlement",
            options: { duplicate: true },
            expect: { status: 200 },
          },
          {
            event: "settlement",
            options: { invalid_signature: true },
            expect: { status: 401 },
          },
        ],
      }),
    );
    expect(result.success).toBe(true);
  });

  it("rejects missing version", () => {
    const result = scenarioFileSchema.safeParse(validScenario({ version: undefined }));
    expect(result.success).toBe(false);
  });

  it("rejects invalid version", () => {
    const result = scenarioFileSchema.safeParse(validScenario({ version: 2 }));
    expect(result.success).toBe(false);
  });

  it("rejects missing provider", () => {
    const result = scenarioFileSchema.safeParse(validScenario({ provider: undefined }));
    expect(result.success).toBe(false);
  });

  it("rejects missing target", () => {
    const result = scenarioFileSchema.safeParse(validScenario({ target: undefined }));
    expect(result.success).toBe(false);
  });

  it("rejects invalid target URL", () => {
    const result = scenarioFileSchema.safeParse(validScenario({ target: "not-a-url" }));
    expect(result.success).toBe(false);
  });

  it("rejects empty steps array", () => {
    const result = scenarioFileSchema.safeParse(validScenario({ steps: [] }));
    expect(result.success).toBe(false);
  });

  it("rejects steps exceeding 100", () => {
    const steps = Array.from({ length: 101 }, () => ({ event: "settlement" }));
    const result = scenarioFileSchema.safeParse(validScenario({ steps }));
    expect(result.success).toBe(false);
  });

  it("rejects unknown top-level keys", () => {
    const result = scenarioFileSchema.safeParse(validScenario({ unknownField: true }));
    expect(result.success).toBe(false);
  });

  it("rejects wait exceeding 60000ms", () => {
    const result = scenarioFileSchema.safeParse(validScenario({ steps: [{ wait: 61000 }] }));
    expect(result.success).toBe(false);
  });

  it("rejects total wait exceeding 300000ms", () => {
    const steps = Array.from({ length: 6 }, () => ({ wait: 60000 }));
    const result = scenarioFileSchema.safeParse(validScenario({ steps }));
    expect(result.success).toBe(false);
  });

  it("rejects both invalid_signature and missing_signature", () => {
    const result = scenarioFileSchema.safeParse(
      validScenario({
        steps: [
          {
            event: "settlement",
            options: { invalid_signature: true, missing_signature: true },
          },
        ],
      }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects error expectation combined with status", () => {
    const result = scenarioFileSchema.safeParse(
      validScenario({
        steps: [
          {
            event: "settlement",
            expect: { error: "TIMEOUT", status: 200 },
          },
        ],
      }),
    );
    expect(result.success).toBe(false);
  });

  it("accepts transport error expectation alone", () => {
    const result = scenarioFileSchema.safeParse(
      validScenario({
        steps: [
          {
            event: "settlement",
            expect: { error: "TIMEOUT" },
          },
        ],
      }),
    );
    expect(result.success).toBe(true);
  });

  it("rejects negative amount", () => {
    const result = scenarioFileSchema.safeParse(validScenario({ variables: { amount: -100 } }));
    expect(result.success).toBe(false);
  });

  it("accepts valid max_duration_ms in expect", () => {
    const result = scenarioFileSchema.safeParse(
      validScenario({
        steps: [{ event: "settlement", expect: { status: 200, max_duration_ms: 5000 } }],
      }),
    );
    expect(result.success).toBe(true);
  });
});
