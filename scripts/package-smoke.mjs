import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = resolve(root, "apps/cli/dist/index.js");

function run(args) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });

  assert.equal(result.error, undefined, `Could not run bayarlab ${args.join(" ")}`);
  assert.equal(
    result.status,
    0,
    `bayarlab ${args.join(" ")} failed (${result.status}): ${result.stderr}`,
  );
  return result.stdout.trim();
}

const providers = JSON.parse(run(["providers", "--output", "json"]));
assert.deepEqual(
  providers.map((provider) => provider.provider).sort(),
  ["demo", "doku", "midtrans", "xendit"],
  "Built CLI should load every registered adapter",
);

for (const [provider, scenario] of [
  ["midtrans", "settlement"],
  ["xendit", "capture"],
  ["doku", "success"],
]) {
  const output = run(["inspect", provider, scenario, "--output", "json"]);
  const inspection = JSON.parse(output);
  assert.equal(inspection.provider, provider);
  assert.equal(inspection.scenario, scenario);
  assert.equal(inspection.signaturePresent, true);
  assert.ok(inspection.request, `${provider} inspect output should include a prepared request`);
  assert.doesNotMatch(
    output,
    /bayarlab-local-test-key|bayarlab-local-xendit-token|bayarlab-local-doku-secret/i,
    `${provider} inspect output must not expose local test credentials`,
  );
}

process.stdout.write(
  "Package smoke check passed: CLI and provider adapters load; inspect output is redacted.\n",
);
