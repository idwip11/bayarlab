import { readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";

import { BayarLabError } from "@bayarlab/core";
import {
  formatReports,
  parseScenarioFile,
  runScenario,
  type ScenarioReport,
} from "@bayarlab/scenario";
import { Command } from "commander";

import { loadRuntimeConfig } from "./config.js";

/**
 * Collect .scenario.yaml and .scenario.yml files from a directory (non-recursive).
 */
async function collectScenarioFiles(dirPath: string): Promise<string[]> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  return entries
    .filter(
      (entry) =>
        entry.isFile() &&
        (entry.name.endsWith(".scenario.yaml") || entry.name.endsWith(".scenario.yml")),
    )
    .map((entry) => resolve(dirPath, entry.name))
    .sort();
}

export function testCommand(): Command {
  return new Command("test")
    .description("Run YAML scenario files for CI-friendly webhook integration testing.")
    .argument("<file>", "Path to a .scenario.yaml file or a directory containing scenario files")
    .option("--output <format>", "text, json, or junit", "text")
    .option("--allow-remote-target", "Explicitly allow a public or production-labelled target")
    .option("--timeout <ms>", "HTTP timeout per step (or BAYARLAB_TIMEOUT_MS)")
    .option("--seed <value>", "Override deterministic seed from CLI")
    .action(async (file: string, options) => {
      try {
        if (!["text", "json", "junit"].includes(options.output)) {
          throw new BayarLabError("INVALID_REQUEST", "Output must be text, json, or junit.");
        }
        const format = options.output as "text" | "json" | "junit";

        const config = loadRuntimeConfig();
        const timeoutMs =
          options.timeout !== undefined ? Number(options.timeout) : config.timeoutMs;

        // Resolve file(s)
        const filePath = resolve(file);
        let files: string[];
        try {
          const fileInfo = await stat(filePath);
          if (fileInfo.isDirectory()) {
            files = await collectScenarioFiles(filePath);
            if (files.length === 0) {
              throw new BayarLabError(
                "INVALID_REQUEST",
                `No .scenario.yaml files found in ${filePath}`,
              );
            }
          } else {
            files = [filePath];
          }
        } catch (cause) {
          if (cause instanceof BayarLabError) throw cause;
          throw new BayarLabError(
            "INVALID_REQUEST",
            `Cannot access path: ${(cause as Error).message}`,
          );
        }

        // Run all scenario files
        const reports: ScenarioReport[] = [];
        const parsedFiles = await Promise.all(
          files.map(async (scenarioFile) => ({
            scenarioFile,
            parsed: await parseScenarioFile(scenarioFile),
          })),
        );
        for (const { scenarioFile, parsed } of parsedFiles) {
          if (parsed.errors.length > 0) {
            throw new BayarLabError(
              "INVALID_REQUEST",
              `${scenarioFile}:\n${parsed.errors.map((error) => `  ${error}`).join("\n")}`,
            );
          }
        }
        for (const { scenarioFile, parsed: parseResult } of parsedFiles) {
          const report = await runScenario(parseResult.scenario, scenarioFile, {
            allowRemoteTarget: options.allowRemoteTarget === true,
            timeoutMs,
            seedOverride: options.seed,
            secrets: [
              parseResult.scenario.provider === "doku"
                ? config.dokuSecret
                : parseResult.scenario.provider === "xendit"
                  ? config.xenditCallbackToken
                  : config.midtransSecret,
            ],
            dokuClientId: config.dokuClientId,
          });

          reports.push(report);
        }

        // Output reports
        process.stdout.write(`${formatReports(reports, format)}\n`);

        // Aggregate exit code
        if (reports.length > 1 && format === "text") {
          const totalPassed = reports.reduce((sum, r) => sum + r.summary.passed, 0);
          const totalFailed = reports.reduce((sum, r) => sum + r.summary.failed, 0);
          const totalFiles = reports.length;
          const allPassed = reports.every((r) => r.passed);
          process.stdout.write(
            `\n${allPassed ? "PASS" : "FAIL"} — ${totalFiles} files, ${totalPassed} passed, ${totalFailed} failed\n`,
          );
        }

        if (!reports.every((r) => r.passed)) {
          process.exitCode = 1;
        }
      } catch (error) {
        process.stderr.write(
          `${error instanceof BayarLabError ? error.code : "UNKNOWN"}: ${error instanceof Error ? error.message : "Scenario test failed."}\n`,
        );
        process.exitCode = 2;
      }
    });
}
