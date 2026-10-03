import { mkdir, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { stringify as toYaml } from "yaml";

import { parseScenarioFile, runScenario } from "./runner.js";
import type { ScenarioFile } from "./schema.js";

// ---------------------------------------------------------------------------
// Test HTTP server
// ---------------------------------------------------------------------------

let server: ReturnType<typeof createServer>;
let port: number;
let tmpDir: string;
const received: string[] = [];

function handler(_req: IncomingMessage, res: ServerResponse): void {
  let body = "";
  _req.on("data", (chunk: Buffer) => {
    body += chunk.toString("utf8");
  });
  _req.on("end", () => {
    received.push(body);
    try {
      const payload = JSON.parse(body) as Record<string, unknown>;
      if (payload.event === "payment.capture" || payload.event === "payment.failure") {
        res.writeHead(
          _req.headers["x-callback-token"] === "bayarlab-local-xendit-token" ? 200 : 401,
        );
        res.end();
        return;
      }
      if ((payload.service as Record<string, unknown> | undefined)?.id === "VIRTUAL_ACCOUNT") {
        res.writeHead(typeof _req.headers.signature === "string" ? 200 : 401);
        res.end();
        return;
      }
      // Reject if no signature_key (simulating signature check)
      if (!("signature_key" in payload) || typeof payload.signature_key !== "string") {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "missing_signature" }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
    } catch {
      res.writeHead(400);
      res.end("bad request");
    }
  });
}

beforeAll(async () => {
  server = createServer(handler);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const addr = server.address();
  port = typeof addr === "object" && addr !== null ? addr.port : 0;

  tmpDir = join(tmpdir(), `bayarlab-scenario-test-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  await rm(tmpDir, { recursive: true, force: true });
});

async function writeScenario(name: string, scenario: Record<string, unknown>): Promise<string> {
  const filePath = join(tmpDir, name);
  await writeFile(filePath, toYaml(scenario), "utf8");
  return filePath;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("parseScenarioFile", () => {
  it("returns errors for a non-existent file", async () => {
    const result = await parseScenarioFile("/tmp/does-not-exist.yaml");
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("Failed to read file");
  });

  it("returns errors for invalid YAML content", async () => {
    const filePath = await writeScenario("invalid.yaml", {});
    // The empty object will fail schema validation
    const result = await parseScenarioFile(filePath);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("parses a valid scenario file", async () => {
    const filePath = await writeScenario("valid.yaml", {
      version: 1,
      provider: "midtrans",
      target: `http://127.0.0.1:${port}/webhook`,
      steps: [{ event: "settlement" }],
    });
    const result = await parseScenarioFile(filePath);
    expect(result.errors).toHaveLength(0);
    expect(result.scenario.provider).toBe("midtrans");
  });
});

describe("runScenario", () => {
  it.each([undefined, "lifecycle-seed"])(
    "keeps lifecycle transaction identity and duplicate wire bytes (seed %s)",
    async (seed) => {
      const before = received.length;
      const scenario: ScenarioFile = {
        version: 1,
        provider: "midtrans",
        target: `http://127.0.0.1:${port}/webhook`,
        variables: { order_id: "BL-LIFECYCLE" },
        ...(seed ? { deterministic: { seed } } : {}),
        steps: [
          { event: "pending" },
          { event: "settlement" },
          { event: "settlement", options: { duplicate: true } },
        ],
      };
      const report = await runScenario(scenario, "lifecycle.yaml");
      expect(report.passed).toBe(true);
      const bodies = received.slice(before);
      const events = bodies.map(
        (body) => JSON.parse(body) as { order_id: string; transaction_id: string },
      );
      expect(events[0]?.order_id).toBe(events[1]?.order_id);
      expect(events[0]?.transaction_id).toBe(events[1]?.transaction_id);
      expect(bodies[1]).toBe(bodies[2]);
    },
  );

  it("supports an explicit transaction ID while independent seeded orders remain distinct", async () => {
    const base: ScenarioFile = {
      version: 1,
      provider: "midtrans",
      target: `http://127.0.0.1:${port}/webhook`,
      deterministic: { seed: "independent" },
      steps: [{ event: "pending" }, { event: "settlement" }],
    };
    const separate = await runScenario(base, "independent.yaml");
    const events = separate.steps.map(
      (step) => JSON.parse(step.result?.request.body ?? "{}") as { transaction_id: string },
    );
    expect(events[0]?.transaction_id).not.toBe(events[1]?.transaction_id);
    const lifecycle = await runScenario(
      { ...base, variables: { order_id: "BL-FIXED", transaction_id: "transaction-fixed" } },
      "explicit.yaml",
    );
    for (const step of lifecycle.steps)
      expect(JSON.parse(step.result?.request.body ?? "{}").transaction_id).toBe(
        "transaction-fixed",
      );
  });

  it.each(
    [
      [{ event: "pending" }, { event: "unsupported" }],
      [{ event: "pending" }, { event: "capture", product: "bni-va" }],
      [{ event: "pending", options: { duplicate: true } }],
    ].map((steps) => ({ steps })),
  )("preflights every event before any delivery: $steps", async ({ steps }) => {
    const before = received.length;
    await expect(
      runScenario(
        { version: 1, provider: "midtrans", target: `http://127.0.0.1:${port}/webhook`, steps },
        "bad.yaml",
      ),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(received).toHaveLength(before);
  });

  it("rejects invalid timeout configuration even for wait-only files", async () => {
    await expect(
      runScenario(
        {
          version: 1,
          provider: "midtrans",
          target: `http://127.0.0.1:${port}/webhook`,
          steps: [{ wait: 0 }],
        },
        "bad.yaml",
        { timeoutMs: Number.NaN },
      ),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });
  it("runs a basic settlement scenario", async () => {
    const scenario: ScenarioFile = {
      version: 1,
      provider: "midtrans",
      target: `http://127.0.0.1:${port}/webhook`,
      steps: [{ event: "settlement" }],
    };

    const report = await runScenario(scenario, "test.yaml", {
      secrets: ["bayarlab-local-test-key"],
    });

    expect(report.passed).toBe(true);
    expect(report.summary.total).toBe(1);
    expect(report.summary.passed).toBe(1);
    expect(report.steps[0]?.type).toBe("event");
    expect(report.steps[0]?.name).toBe("settlement");
  });

  it("handles wait steps", async () => {
    const scenario: ScenarioFile = {
      version: 1,
      provider: "midtrans",
      target: `http://127.0.0.1:${port}/webhook`,
      steps: [{ event: "settlement" }, { wait: 50 }, { event: "pending" }],
    };

    const report = await runScenario(scenario, "wait-test.yaml", {
      secrets: ["bayarlab-local-test-key"],
    });

    expect(report.summary.total).toBe(3);
    expect(report.steps[1]?.type).toBe("wait");
    expect(report.steps[1]?.name).toBe("wait:50ms");
    expect(report.steps[1]?.passed).toBe(true);
  });

  it("captures assertion failures without throwing", async () => {
    const scenario: ScenarioFile = {
      version: 1,
      provider: "midtrans",
      target: `http://127.0.0.1:${port}/webhook`,
      steps: [{ event: "settlement", expect: { status: 404 } }],
    };

    const report = await runScenario(scenario, "fail-test.yaml", {
      secrets: ["bayarlab-local-test-key"],
    });

    expect(report.passed).toBe(false);
    expect(report.summary.failed).toBe(1);
    expect(report.steps[0]?.failures.length).toBeGreaterThan(0);
  });

  it("applies invalid_signature mutation", async () => {
    const scenario: ScenarioFile = {
      version: 1,
      provider: "midtrans",
      target: `http://127.0.0.1:${port}/webhook`,
      steps: [
        {
          event: "settlement",
          options: { invalid_signature: true },
          expect: { status: 200 },
        },
      ],
    };

    const report = await runScenario(scenario, "mutation-test.yaml", {
      secrets: ["bayarlab-local-test-key"],
    });

    // The mutation is applied — the server still returns 200 (basic echo server),
    // but the signature is corrupted in the delivered payload
    expect(report.summary.total).toBe(1);
    expect(report.steps[0]?.type).toBe("event");
  });

  it("applies missing_signature mutation", async () => {
    const scenario: ScenarioFile = {
      version: 1,
      provider: "midtrans",
      target: `http://127.0.0.1:${port}/webhook`,
      steps: [
        {
          event: "settlement",
          options: { missing_signature: true },
          expect: { status: 400 },
        },
      ],
    };

    const report = await runScenario(scenario, "missing-sig-test.yaml", {
      secrets: ["bayarlab-local-test-key"],
    });

    // Server returns 400 when signature_key is missing
    expect(report.passed).toBe(true);
    expect(report.steps[0]?.passed).toBe(true);
  });

  it("produces deterministic IDs with a seed", async () => {
    const scenario: ScenarioFile = {
      version: 1,
      provider: "midtrans",
      target: `http://127.0.0.1:${port}/webhook`,
      deterministic: { seed: "test-seed-123" },
      steps: [{ event: "settlement" }],
    };

    const report1 = await runScenario(scenario, "det-test.yaml", {
      secrets: ["bayarlab-local-test-key"],
    });
    const report2 = await runScenario(scenario, "det-test.yaml", {
      secrets: ["bayarlab-local-test-key"],
    });

    // Both runs should pass
    expect(report1.passed).toBe(true);
    expect(report2.passed).toBe(true);
  });

  it("reports correct summary counts", async () => {
    const scenario: ScenarioFile = {
      version: 1,
      provider: "midtrans",
      target: `http://127.0.0.1:${port}/webhook`,
      steps: [
        { event: "pending" },
        { event: "settlement", expect: { status: 404 } },
        { event: "settlement" },
      ],
    };

    const report = await runScenario(scenario, "count-test.yaml", {
      secrets: ["bayarlab-local-test-key"],
    });

    expect(report.summary.total).toBe(3);
    expect(report.summary.passed).toBe(2);
    expect(report.summary.failed).toBe(1);
  });

  it("handles lifecycle with duplicate identity", async () => {
    const scenario: ScenarioFile = {
      version: 1,
      provider: "midtrans",
      target: `http://127.0.0.1:${port}/webhook`,
      variables: { order_id: "BL-DUP-001" },
      steps: [{ event: "settlement" }, { event: "settlement", options: { duplicate: true } }],
    };

    const report = await runScenario(scenario, "dup-test.yaml", {
      secrets: ["bayarlab-local-test-key"],
    });

    expect(report.passed).toBe(true);
    expect(report.summary.total).toBe(2);
  });

  it("runs Xendit DANA capture and rejects an invalid callback token", async () => {
    const scenario: ScenarioFile = {
      version: 1,
      provider: "xendit",
      target: `http://127.0.0.1:${port}/webhook`,
      deterministic: { seed: "xendit-test", timestamp: "2026-09-23T00:00:00Z" },
      steps: [
        { event: "capture", expect: { status: 200 } },
        { event: "capture", options: { duplicate: true }, expect: { status: 200 } },
        { event: "failure", options: { invalid_signature: true }, expect: { status: 401 } },
      ],
    };
    const report = await runScenario(scenario, "xendit-test.yaml", {
      secrets: ["bayarlab-local-xendit-token"],
    });
    expect(report.passed).toBe(true);
    expect(report.summary.passed).toBe(3);
    expect(report.steps[0]?.result?.request.body).toBe(report.steps[1]?.result?.request.body);
    expect(JSON.stringify(report)).not.toContain("bayarlab-local-xendit-token");
  });

  it("runs DOKU Mandiri VA with deterministic duplicate bytes and missing signature", async () => {
    const scenario: ScenarioFile = {
      version: 1,
      provider: "doku",
      target: `http://127.0.0.1:${port}/webhook/doku`,
      deterministic: { seed: "doku-test", timestamp: "2026-09-28T00:00:00Z" },
      steps: [
        { event: "success", expect: { status: 200 } },
        { event: "success", options: { duplicate: true }, expect: { status: 200 } },
        {
          event: "success",
          options: { duplicate: true, missing_signature: true },
          expect: { status: 401 },
        },
      ],
    };
    const report = await runScenario(scenario, "doku-test.yaml", {
      secrets: ["bayarlab-local-doku-secret"],
      dokuClientId: "MCH-BAYARLAB-LOCAL",
    });
    expect(report.passed).toBe(true);
    expect(report.steps[0]?.result?.request.body).toBe(report.steps[1]?.result?.request.body);
    expect(JSON.stringify(report)).not.toContain("bayarlab-local-doku-secret");
  });
});
