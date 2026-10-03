import dns from "node:dns/promises";
import { syncBuiltinESMExports } from "node:module";
import { resolveTarget } from "@bayarlab/engine";
import { describe, expect, it, vi } from "vitest";
import { acknowledgeTarget } from "./interactive.js";

describe("interactive target consent", () => {
  it("does not turn on the override for local targets", async () => {
    const ask = vi.fn();
    for (const target of ["http://localhost/webhook", "http://127.0.0.1/", "http://10.0.0.1/"]) {
      expect(await acknowledgeTarget(target, ask)).toBe(false);
    }
    expect(ask).not.toHaveBeenCalled();
  });

  it("only turns on the override after an affirmative remote confirmation", async () => {
    await expect(
      acknowledgeTarget("https://prod.example/webhook", async () => "n"),
    ).rejects.toMatchObject({ code: "REMOTE_TARGET_NOT_ALLOWED" });
    expect(await acknowledgeTarget("https://prod.example/webhook", async () => "y")).toBe(true);
  });

  it("retains the resolved-address guard when localhost resolves outside development ranges", async () => {
    const lookup = vi
      .spyOn(dns, "lookup")
      .mockImplementation((async () => [
        { address: "8.8.8.8", family: 4 },
      ]) as unknown as typeof dns.lookup);
    syncBuiltinESMExports();
    try {
      const target = "http://localhost/webhook";
      await expect(
        resolveTarget(target, await acknowledgeTarget(target, vi.fn())),
      ).rejects.toMatchObject({ code: "REMOTE_TARGET_NOT_ALLOWED" });
    } finally {
      lookup.mockRestore();
      syncBuiltinESMExports();
    }
  });
});
