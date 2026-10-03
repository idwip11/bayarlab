#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { BayarLabError } from "@bayarlab/core";
import {
  deliver,
  formatDelivery,
  prepareSignedRequest,
  redactTargetUrl,
  toDisplayResult,
} from "@bayarlab/engine";
import { demoAdapter } from "@bayarlab/provider-demo";
import { dokuAdapter } from "@bayarlab/provider-doku";
import { midtransAdapter } from "@bayarlab/provider-midtrans";
import { xenditAdapter } from "@bayarlab/provider-xendit";
import { startDashboard } from "@bayarlab/web";
import { Command, CommanderError } from "commander";
import { chaosCommand } from "./chaos.js";
import { loadRuntimeConfig } from "./config.js";
import { launchInteractive } from "./interactive.js";
import { formatSend, prepareProviderRequest, requestSucceeded, sendProvider } from "./run.js";
import { testCommand } from "./test-command.js";

function commandError(error: unknown): void {
  const code = error instanceof BayarLabError ? error.code : "UNKNOWN";
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${code}: ${message}\n`);
  process.exitCode = 2;
}

function parseOptionalNumber(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const result = Number(value);
  if (!Number.isFinite(result))
    throw new BayarLabError("INVALID_REQUEST", `${name} must be a number.`);
  return result;
}

export const createProgram = (): Command => {
  const program = new Command();
  program.addCommand(chaosCommand().exitOverride());
  program.addCommand(testCommand().exitOverride());

  program
    .name("bayarlab")
    .description("Local payment webhook simulator for Indonesian developers.")
    .version("0.1.0")
    .exitOverride()
    .showHelpAfterError();

  program
    .command("providers")
    .description("List providers available in this installation.")
    .option("--output <format>", "text or json", "text")
    .action((options) => {
      if (options.output === "json") {
        process.stdout.write(
          `${JSON.stringify([demoAdapter.manifest, midtransAdapter.manifest, xenditAdapter.manifest, dokuAdapter.manifest])}\n`,
        );
        return;
      }
      if (options.output !== "text")
        throw new BayarLabError("INVALID_REQUEST", "Output must be text or json.");
      process.stdout.write(
        "Demo (synthetic)\nMidtrans (BNI VA, credit card)\nXendit (Payments API v3, ID DANA)\nDOKU (non-SNAP Mandiri VA)\n",
      );
    });

  program
    .command("config")
    .description("Show effective V0.1 runtime configuration without revealing secrets.")
    .action(() => {
      try {
        const config = loadRuntimeConfig();
        process.stdout.write(
          `${JSON.stringify(
            {
              amount: config.amount,
              target: config.target
                ? redactTargetUrl(config.target, [
                    config.midtransSecret,
                    config.xenditCallbackToken,
                    config.dokuSecret,
                  ])
                : null,
              timeoutMs: config.timeoutMs,
              midtransSecret: `[configured via ${config.sources.midtransSecret}]`,
              xenditCallbackToken: `[configured via ${config.sources.xenditCallbackToken}]`,
              dokuClientId: config.dokuClientId,
              dokuSecret: `[configured via ${config.sources.dokuSecret}]`,
              sources: config.sources,
              persistence: "disabled (V0.1)",
            },
            null,
            2,
          )}\n`,
        );
      } catch (error) {
        commandError(error);
      }
    });

  program
    .command("ui")
    .description("Start the local BayarLab dashboard on 127.0.0.1.")
    .option("--port <port>", "Local dashboard port", "8787")
    .action(async (options) => {
      try {
        const port = Number(options.port);
        if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
          throw new BayarLabError("INVALID_REQUEST", "Port must be an integer from 1 to 65535.");
        }
        const { app, url } = await startDashboard(port);
        process.stdout.write(`BayarLab dashboard available at ${url}\nPress Ctrl+C to stop.\n`);
        const close = () => {
          void app.close();
        };
        process.once("SIGINT", close);
        process.once("SIGTERM", close);
      } catch (error) {
        commandError(error);
      }
    });

  program
    .command("inspect <provider> <scenario>")
    .description("Build and sign an event locally without sending it.")
    .option("--to <url>", "Target URL used for request preparation")
    .option("--product <product>", "Provider product profile (inferred from scenario)")
    .option("--order-id <id>", "Synthetic order ID")
    .option("--amount <idr>", "Whole IDR amount")
    .option("--invalid-signature", "Show the deliberately corrupted signature variant")
    .option("--output <format>", "text or json", "text")
    .action(async (provider: string, scenario: string, options) => {
      try {
        if (options.output !== "text" && options.output !== "json") {
          throw new BayarLabError("INVALID_REQUEST", "Output must be text or json.");
        }
        const config = loadRuntimeConfig();
        const { request, secret } = await prepareProviderRequest(
          {
            provider,
            scenario,
            target: options.to ?? config.target ?? "http://127.0.0.1:3000/webhook",
            ...(options.product === undefined ? {} : { product: options.product }),
            ...(options.orderId === undefined ? {} : { orderId: options.orderId }),
            ...(options.amount === undefined
              ? {}
              : { amount: parseOptionalNumber(options.amount, "Amount") }),
            invalidSignature: options.invalidSignature === true,
          },
          config,
        );
        const display = toDisplayResult(
          { requestId: "inspect", targetUrl: request.targetUrl, request, durationMs: 0 },
          [secret],
        );
        if (options.output === "json") {
          process.stdout.write(
            `${JSON.stringify({ provider, scenario, signaturePresent: true, request: display.request })}\n`,
          );
        } else {
          process.stdout.write(
            `${provider} ${scenario} (not sent)\nAuthentication: present and masked\n${display.request.body}\n`,
          );
        }
      } catch (error) {
        commandError(error);
      }
    });

  program
    .command("demo")
    .description("Send a signed synthetic webhook to a development endpoint.")
    .requiredOption("--to <url>", "Full HTTP(S) target URL")
    .option("--secret <value>", "Synthetic shared secret", "bayarlab-local-test-key")
    .option("--output <format>", "text or json", "text")
    .option("--timeout <milliseconds>", "Total response timeout", "15000")
    .option("--allow-remote-target", "Explicitly allow a public or production-labelled target")
    .action(async (options) => {
      try {
        if (options.output !== "text" && options.output !== "json") {
          throw new BayarLabError("INVALID_REQUEST", "Output must be text or json.");
        }
        const event = await demoAdapter.buildEvent({ scenario: "paid", product: "synthetic" });
        const wireRequest = await prepareSignedRequest(demoAdapter, event, options.to, {
          secret: options.secret,
        });
        const result = await deliver(wireRequest, {
          timeoutMs: Number(options.timeout),
          allowRemoteTarget: options.allowRemoteTarget === true,
        });
        process.stdout.write(`${formatDelivery(result, options.output, [options.secret])}\n`);
        if (!requestSucceeded(result)) process.exitCode = 1;
      } catch (error) {
        commandError(error);
      }
    });

  program
    .command("send <provider> <scenario>")
    .description("Send one signed provider webhook to a development endpoint.")
    .option("--to <url>", "Full HTTP(S) target URL; overrides BAYARLAB_TARGET")
    .option("--product <product>", "Provider product profile (inferred from scenario)")
    .option("--order-id <id>", "Synthetic order ID")
    .option("--amount <idr>", "Whole IDR amount; overrides BAYARLAB_AMOUNT")
    .option("--invalid-signature", "Corrupt the provider authentication field after signing")
    .option("--expect-status <code>", "Expected receiver HTTP status")
    .option("--repeat <count>", "Total sequential deliveries of the same event", "1")
    .option("--same-event-id", "Required when repeat is greater than one")
    .option("--output <format>", "text or json", "text")
    .option("--timeout <milliseconds>", "Total response timeout; overrides BAYARLAB_TIMEOUT_MS")
    .option("--allow-remote-target", "Explicitly allow a public or production-labelled target")
    .action(async (provider: string, scenario: string, options) => {
      try {
        if (options.output !== "text" && options.output !== "json") {
          throw new BayarLabError("INVALID_REQUEST", "Output must be text or json.");
        }
        const result = await sendProvider(
          {
            provider,
            scenario,
            ...(options.to === undefined ? {} : { target: options.to }),
            ...(options.product === undefined ? {} : { product: options.product }),
            ...(options.orderId === undefined ? {} : { orderId: options.orderId }),
            ...(options.amount === undefined
              ? {}
              : { amount: parseOptionalNumber(options.amount, "Amount") }),
            ...(options.timeout === undefined
              ? {}
              : { timeoutMs: parseOptionalNumber(options.timeout, "Timeout") }),
            ...(options.expectStatus === undefined
              ? {}
              : { expectStatus: parseOptionalNumber(options.expectStatus, "Expected status") }),
            repeat: parseOptionalNumber(options.repeat, "Repeat"),
            sameEventId: options.sameEventId === true,
            invalidSignature: options.invalidSignature === true,
            allowRemoteTarget: options.allowRemoteTarget === true,
          },
          loadRuntimeConfig(),
        );
        process.stdout.write(`${formatSend(result, options.output)}\n`);
        if (!result.results.every((attempt) => requestSucceeded(attempt, result.expectedStatus)))
          process.exitCode = 1;
      } catch (error) {
        commandError(error);
      }
    });

  return program;
};

const entrypoint = process.argv[1];

export async function main(args = process.argv): Promise<void> {
  const program = createProgram();
  try {
    if (args.length === 2) {
      if (process.stdout.isTTY && process.stdin.isTTY) {
        process.exitCode = await launchInteractive(loadRuntimeConfig());
      } else {
        program.outputHelp();
      }
    } else {
      await program.parseAsync(args);
    }
  } catch (error) {
    if (error instanceof CommanderError) {
      process.exitCode = error.exitCode === 0 ? 0 : 2;
    } else {
      commandError(error);
    }
  }
}

if (entrypoint !== undefined && import.meta.url === pathToFileURL(realpathSync(entrypoint)).href) {
  void main();
}
