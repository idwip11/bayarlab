import { describe, expect, it } from "vitest";

import { deriveId, deriveTimestamp } from "./deterministic.js";

describe("deriveId", () => {
  it("returns a valid UUID v4 format string", () => {
    const id = deriveId("test-seed", 0, "event");
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("produces the same ID for the same inputs", () => {
    const a = deriveId("seed-abc", 3, "transaction");
    const b = deriveId("seed-abc", 3, "transaction");
    expect(a).toBe(b);
  });

  it("produces different IDs for different seeds", () => {
    const a = deriveId("seed-1", 0, "event");
    const b = deriveId("seed-2", 0, "event");
    expect(a).not.toBe(b);
  });

  it("produces different IDs for different indices", () => {
    const a = deriveId("same-seed", 0, "event");
    const b = deriveId("same-seed", 1, "event");
    expect(a).not.toBe(b);
  });

  it("produces different IDs for different labels", () => {
    const a = deriveId("same-seed", 0, "event");
    const b = deriveId("same-seed", 0, "transaction");
    expect(a).not.toBe(b);
  });
});

describe("deriveTimestamp", () => {
  it("returns the base date for step index 0", () => {
    const base = new Date("2026-01-15T10:00:00Z");
    const result = deriveTimestamp(base, 0);
    expect(result.toISOString()).toBe("2026-01-15T10:00:00.000Z");
  });

  it("offsets by 1 second per step index", () => {
    const base = new Date("2026-01-15T10:00:00Z");
    expect(deriveTimestamp(base, 1).toISOString()).toBe("2026-01-15T10:00:01.000Z");
    expect(deriveTimestamp(base, 5).toISOString()).toBe("2026-01-15T10:00:05.000Z");
  });

  it("accepts an ISO string as base", () => {
    const result = deriveTimestamp("2026-06-01T00:00:00Z", 10);
    expect(result.toISOString()).toBe("2026-06-01T00:00:10.000Z");
  });

  it("throws on invalid base timestamp", () => {
    expect(() => deriveTimestamp("not-a-date", 0)).toThrow("Invalid base timestamp");
  });

  it("throws on negative step index", () => {
    expect(() => deriveTimestamp(new Date(), -1)).toThrow("non-negative integer");
  });
});
