import { randomUUID } from "node:crypto";
import { BayarLabError } from "@bayarlab/core";
import {
  type ChaosMutation,
  formatDelivery,
  prepareSignedRequest,
  type ReliabilityStep,
  type ResponseAssertions,
  runReliabilityScenario,
  toDisplayResult,
} from "@bayarlab/engine";
import { dokuAdapter } from "@bayarlab/provider-doku";
import { midtransAdapter } from "@bayarlab/provider-midtrans";
import { xenditAdapter } from "@bayarlab/provider-xendit";
import { Command } from "commander";
import { loadRuntimeConfig } from "./config.js";

export function chaosCommand(): Command {
  return new Command("chaos")
    .description(
      "Run bounded provider reliability experiments; Midtrans lifecycle uses BNI pending → settlement.",
    )
    .argument("<provider>")
    .argument("<scenario>", "Provider preset or Midtrans lifecycle")
    .option("--to <url>", "Target URL (or BAYARLAB_TARGET)")
    .option("--amount <idr>", "Whole IDR amount before signing")
    .option("--order-id <id>", "Shared order ID")
    .option("--duplicate <count>", "Total deliveries per step, including the original", "1")
    .option("--delay <ms>", "Delay before every attempt (0–60000)", "0")
    .option("--invalid-signature", "Corrupt signature after signing")
    .option("--missing-signature", "Remove signature after signing")
    .option("--remove-field <field...>", "Remove top-level fields after signing")
    .option("--set-field <assignment...>", "Set top-level field=JSON after signing")
    .option("--malformed-body", "Append invalid JSON syntax after signing")
    .option("--out-of-order", "Deliver lifecycle settlement before pending")
    .option("--expect-status <code>", "Require an exact receiver HTTP status (default 2xx)")
    .option("--expect-body <text>", "Require text in the complete response")
    .option("--expect-error <code>", "Require TIMEOUT or NETWORK_ERROR")
    .option("--max-duration <ms>", "Maximum HTTP delivery duration, excluding injected delay")
    .option("--timeout <ms>", "HTTP timeout (or BAYARLAB_TIMEOUT_MS)")
    .option("--allow-remote-target", "Explicitly authorize a public/production-labelled target")
    .option("--output <format>", "text or json", "text")
    .action(async (provider: string, scenario: string, options) => {
      try {
        if (provider !== "midtrans" && provider !== "xendit" && provider !== "doku")
          throw new BayarLabError("INVALID_REQUEST", `Unsupported provider: ${provider}`);
        if (provider !== "midtrans" && scenario === "lifecycle")
          throw new BayarLabError(
            "INVALID_REQUEST",
            `${provider} does not provide a multi-event lifecycle preset.`,
          );
        if (!["text", "json"].includes(options.output))
          throw new BayarLabError("INVALID_REQUEST", "Output must be text or json.");
        if (options.invalidSignature && options.missingSignature)
          throw new BayarLabError("INVALID_REQUEST", "Choose either invalid or missing signature.");
        if (options.outOfOrder && scenario !== "lifecycle")
          throw new BayarLabError("INVALID_REQUEST", "--out-of-order requires lifecycle.");
        const config = loadRuntimeConfig();
        const target = options.to ?? config.target;
        if (!target) throw new BayarLabError("INVALID_REQUEST", "Provide --to or BAYARLAB_TARGET.");
        const setFields: Record<string, unknown> = Object.create(null);
        for (const assignment of (options.setField ?? []) as string[]) {
          const separator = assignment.indexOf("=");
          if (separator < 1)
            throw new BayarLabError("INVALID_REQUEST", "Use --set-field field=JSON.");
          try {
            setFields[assignment.slice(0, separator)] = JSON.parse(assignment.slice(separator + 1));
          } catch {
            throw new BayarLabError(
              "INVALID_REQUEST",
              "Field values must be valid JSON; quote strings.",
            );
          }
        }
        const mutation: ChaosMutation = {
          setFields,
          removeFields: options.removeField ?? [],
          malformedBody: options.malformedBody === true,
          ...(options.invalidSignature || options.missingSignature
            ? {
                signature: {
                  location: provider === "midtrans" ? ("body" as const) : ("header" as const),
                  name:
                    provider === "doku"
                      ? "Signature"
                      : provider === "xendit"
                        ? "x-callback-token"
                        : "signature_key",
                  mode: options.missingSignature ? ("missing" as const) : ("invalid" as const),
                },
              }
            : {}),
        };
        const expect: ResponseAssertions = {
          ...(options.expectStatus === undefined ? {} : { status: Number(options.expectStatus) }),
          ...(options.expectBody === undefined ? {} : { bodyIncludes: options.expectBody }),
          ...(options.expectError === undefined ? {} : { error: options.expectError }),
          ...(options.maxDuration === undefined
            ? {}
            : { maxDurationMs: Number(options.maxDuration) }),
        };
        const orderId = options.orderId ?? `BL-${randomUUID().slice(0, 8)}`;
        const transactionId = randomUUID();
        const now = new Date();
        const adapter =
          provider === "doku"
            ? dokuAdapter
            : provider === "xendit"
              ? xenditAdapter
              : midtransAdapter;
        const secret =
          provider === "doku"
            ? config.dokuSecret
            : provider === "xendit"
              ? config.xenditCallbackToken
              : config.midtransSecret;
        const steps: ReliabilityStep[] = [];
        for (const name of scenario === "lifecycle" ? ["pending", "settlement"] : [scenario]) {
          const definition = adapter.listScenarios().find((item) => item.id === name);
          if (!definition)
            throw new BayarLabError("INVALID_REQUEST", `Unsupported ${provider} scenario.`);
          const event = await adapter.buildEvent({
            product: definition.product,
            scenario: name,
            orderId,
            transactionId,
            now,
            amount: options.amount === undefined ? config.amount : Number(options.amount),
          });
          steps.push({
            name,
            request: await prepareSignedRequest(adapter, event, target, {
              secret,
              ...(provider === "doku" ? { clientId: config.dokuClientId } : {}),
            }),
            mutation,
            expect,
            copies: Number(options.duplicate),
            delayMs: Number(options.delay),
          });
        }
        const report = await runReliabilityScenario(steps, {
          reverse: options.outOfOrder === true,
          allowRemoteTarget: options.allowRemoteTarget === true,
          timeoutMs: options.timeout === undefined ? config.timeoutMs : Number(options.timeout),
        });
        const secrets = [secret];
        if (options.output === "json") {
          process.stdout.write(
            `${JSON.stringify({
              passed: report.passed,
              attempts: report.attempts.map(({ step, copy, result, failures }) => ({
                step,
                copy,
                failures,
                result: toDisplayResult(result, secrets),
              })),
            })}\n`,
          );
        } else {
          for (const attempt of report.attempts) {
            process.stdout.write(
              attempt.step +
                " #" +
                attempt.copy +
                "\n" +
                formatDelivery(attempt.result, "text", secrets) +
                "\n",
            );
            for (const failure of attempt.failures) process.stdout.write(`FAIL: ${failure}\n`);
          }
          process.stdout.write(
            `${report.passed ? "PASS" : "FAIL"} — receiver response assertions\n`,
          );
        }
        if (!report.passed) process.exitCode = 1;
      } catch (error) {
        process.stderr.write(
          (error instanceof BayarLabError ? error.code : "UNKNOWN") +
            ": " +
            (error instanceof Error ? error.message : "Chaos run failed.") +
            "\n",
        );
        process.exitCode = 2;
      }
    });
}
