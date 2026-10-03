import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const temporary = await mkdtemp(join(tmpdir(), "bayarlab-release-smoke-"));
const consumer = join(temporary, "consumer");
await mkdir(consumer);
const env = { ...process.env, NO_COLOR: "1", npm_config_cache: join(temporary, "npm-cache") };
for (const name of Object.keys(env)) if (name.startsWith("BAYARLAB_")) delete env[name];

function run(command, args, cwd = consumer, expectedStatus = 0) {
  // npm is a .cmd shim on Windows; only fixed commands and generated local paths are supplied.
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    timeout: 120_000,
    shell: process.platform === "win32",
  });
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.status, expectedStatus, `${command} ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

let dashboard;
try {
  const packed = JSON.parse(
    run("npm", ["pack", root, "--ignore-scripts", "--json", "--pack-destination", temporary]),
  )[0];
  assert.equal(packed.name, "bayarlab");
  const files = packed.files.map((file) => file.path);
  for (const required of [
    "package.json",
    "LICENSE",
    "README.md",
    "dist/index.js",
    "dist/client/index.html",
    "dist/licenses/react.txt",
    "dist/licenses/react-dom.txt",
    "dist/licenses/scheduler.txt",
  ])
    assert.ok(files.includes(required), `Archive lacks ${required}`);
  assert.ok(
    files.every(
      (file) =>
        ["package.json", "LICENSE", "README.md", "dist/index.js"].includes(file) ||
        file.startsWith("dist/client/") ||
        /^dist\/licenses\/(react|react-dom|scheduler)\.txt$/.test(file),
    ),
    "Unexpected release content",
  );
  assert.ok(
    files.every((file) => !/\.test\.|\.map$|tsbuildinfo|node_modules/.test(file)),
    "Development files leaked into the archive",
  );
  run("npm", [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    join(temporary, packed.filename),
  ]);
  const installed = JSON.parse(
    await readFile(join(consumer, "node_modules/bayarlab/package.json"), "utf8"),
  );
  assert.equal(installed.license, "MIT");
  for (const name of ["react", "react-dom", "scheduler"]) {
    const license = await readFile(
      join(consumer, `node_modules/bayarlab/dist/licenses/${name}.txt`),
      "utf8",
    );
    assert.match(license, /Copyright/);
    assert.match(license, /Permission is hereby granted/);
  }
  assert.match(
    await readFile(join(consumer, "node_modules/bayarlab/LICENSE"), "utf8"),
    /Copyright \(c\) 2026 BayarLab contributors/,
  );
  const installedAudit = JSON.parse(run("npm", ["audit", "--omit=dev", "--json"]));
  assert.equal(
    installedAudit.metadata.vulnerabilities.total,
    0,
    "Installed runtime dependencies have advisories",
  );
  assert.ok(
    Object.values(installed.dependencies).every((value) => !value.startsWith("workspace:")),
    "Release requires a workspace",
  );
  const cli = join(consumer, "node_modules/bayarlab/dist/index.js");
  const cliRun = (args, code = 0) => run(process.execPath, [cli, ...args], consumer, code);
  assert.match(cliRun(["--help"]), /Usage: bayarlab/);
  assert.match(cliRun([]), /Usage: bayarlab/);
  assert.equal(cliRun(["--version"]), manifest.version);
  // --no prevents registry fallback: this must execute the locally installed bayarlab bin.
  assert.equal(run("npm", ["exec", "--no", "--", "bayarlab", "--version"]), manifest.version);
  assert.equal(run("npx", ["--no-install", "bayarlab", "--version"]), manifest.version);
  assert.deepEqual(
    JSON.parse(cliRun(["providers", "--output", "json"]))
      .map((provider) => provider.provider)
      .sort(),
    ["demo", "doku", "midtrans", "xendit"],
  );
  for (const [provider, scenario] of [
    ["midtrans", "settlement"],
    ["xendit", "capture"],
    ["doku", "success"],
  ]) {
    const output = cliRun(["inspect", provider, scenario, "--output", "json"]);
    assert.equal(JSON.parse(output).signaturePresent, true);
    assert.doesNotMatch(output, /bayarlab-local-(test-key|xendit-token|doku-secret)/);
  }
  for (const args of [
    ["unknown-command"],
    ["send"],
    ["test"],
    ["chaos"],
    ["test", "--unknown-option"],
    ["chaos", "--unknown-option"],
    ["providers", "--output", "invalid"],
    ["inspect", "midtrans", "unknown"],
    ["test", "does-not-exist.yaml"],
  ]) {
    cliRun(args, 2);
  }

  const socket = createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const port = socket.address().port;
  await new Promise((resolveClose) => socket.close(resolveClose));
  dashboard = spawn(process.execPath, [cli, "ui", "--port", String(port)], {
    cwd: consumer,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  dashboard.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  let page;
  for (let attempt = 0; attempt < 100; attempt++) {
    assert.equal(dashboard.exitCode, null, `Installed dashboard exited: ${stderr}`);
    try {
      page = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) });
      break;
    } catch {
      await sleep(100);
    }
  }
  assert.ok(page?.ok, `Installed dashboard did not start: ${stderr}`);
  const html = await page.text();
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((match) => match[1]);
  assert.ok(
    assets.some((asset) => asset.endsWith(".js")),
    "Dashboard has no JavaScript asset",
  );
  for (const asset of assets) {
    const response = await fetch(`http://127.0.0.1:${port}${asset}`);
    assert.equal(response.status, 200, `Dashboard asset failed: ${asset}`);
    assert.ok((await response.text()).length > 0);
  }
  process.stdout.write(
    `Installed release smoke passed: bayarlab ${manifest.version}, ${files.length} allowlisted files, executable/npm exec/npx, zero runtime advisories, all provider inspections, dashboard assets.\n`,
  );
} finally {
  if (dashboard && dashboard.exitCode === null) {
    const exited = once(dashboard, "exit");
    dashboard.kill("SIGTERM");
    await exited;
  }
  // Only the uniquely created smoke directory is removed; no workspace or user data is touched.
  await rm(temporary, { recursive: true, force: true });
}
