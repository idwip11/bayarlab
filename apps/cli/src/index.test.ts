import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { createProgram } from "./index.js";

const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));
function run(args: string[], extraEnv: Record<string, string> = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...extraEnv },
    timeout: 10_000,
  });
}

describe("BayarLab CLI", () => {
  it.each(
    [
      ["unknown-command"],
      ["send"],
      ["test"],
      ["chaos"],
      ["test", "--unknown-option"],
      ["chaos", "--unknown-option"],
      ["providers", "--output", "invalid"],
      ["inspect", "midtrans", "unsupported"],
      ["--unknown-option"],
    ].map((args) => ({ args })),
  )("returns configuration exit 2 without a stack for $args", ({ args }) => {
    const result = run(args);
    expect(result.status).toBe(2);
    expect(result.stderr).not.toMatch(/\n\s+at /);
  });

  it.each([[], ["--help"], ["--version"]].map((args) => ({ args })))(
    "returns success for non-TTY help/version: %j",
    ({ args }) => {
      expect(run(args).status).toBe(0);
    },
  );

  it("redacts configured sensitive URL values without modifying the runtime target", () => {
    const result = run(["config"], {
      BAYARLAB_TARGET: "http://localhost/webhook?token=RC-URL-TOKEN&note=known%22secret",
      BAYARLAB_XENDIT_CALLBACK_TOKEN: 'known"secret',
    });
    expect(result.status).toBe(0);
    const target = new URL(JSON.parse(result.stdout).target as string);
    expect(target.searchParams.get("token")).toBe("[REDACTED]");
    expect(target.searchParams.get("note")).toBe("[REDACTED]");
    expect(result.stdout).not.toContain("RC-URL-TOKEN");
  });

  it("emits one JSON/XML report for a directory and rejects mistyped assertions with exit 2", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bayarlab-cli-report-"));
    try {
      const scenario =
        "version: 1\nprovider: midtrans\ntarget: http://127.0.0.1/webhook\nsteps:\n  - wait: 0\n";
      await writeFile(join(directory, "one.scenario.yaml"), scenario);
      await writeFile(join(directory, "two.scenario.yaml"), scenario);
      const json = run(["test", directory, "--output", "json"]);
      expect(json.status).toBe(0);
      expect(JSON.parse(json.stdout)).toMatchObject({ passed: true, summary: { total: 2 } });
      const xml = run(["test", directory, "--output", "junit"]);
      expect(xml.status).toBe(0);
      expect(xml.stdout.match(/<\?xml/g)).toHaveLength(1);
      expect(xml.stdout.match(/<testsuite /g)).toHaveLength(2);
      await writeFile(
        join(directory, "bad.scenario.yaml"),
        "version: 1\nprovider: midtrans\ntarget: http://127.0.0.1/webhook\nsteps:\n  - event: settlement\n    exepct: {status: 401}\n",
      );
      const bad = run(["test", directory]);
      expect(bad.status).toBe(2);
      expect(bad.stderr).toContain("steps.0");
      expect(bad.stdout).toBe("");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("declares the initial command surface", () => {
    const commandNames = createProgram().commands.map((command) => command.name());

    expect(commandNames).toContain("providers");
    expect(commandNames).toContain("send");
  });
});
