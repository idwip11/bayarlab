import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

import { BayarLabError } from "@bayarlab/core";
import { redactTargetUrl, toDisplayResult } from "@bayarlab/engine";
import { dokuAdapter } from "@bayarlab/provider-doku";
import { midtransAdapter } from "@bayarlab/provider-midtrans";
import { xenditAdapter } from "@bayarlab/provider-xendit";

import type { RuntimeConfig } from "./config.js";
import { SessionHistory } from "./history.js";
import { formatSend, replayProvider, requestSucceeded, sendProvider } from "./run.js";

async function askChoice(
  ask: (question: string) => Promise<string>,
  prompt: string,
  choices: readonly { id: string; label: string }[],
): Promise<string> {
  output.write(`\n${prompt}\n`);
  choices.forEach((choice, index) => {
    output.write(`  ${index + 1}. ${choice.label}\n`);
  });
  const answer = (await ask("> ")).trim();
  const selected = choices[Number(answer) - 1];
  if (!selected) throw new BayarLabError("INVALID_REQUEST", "Choose one of the listed options.");
  return selected.id;
}

export function needsRemoteAcknowledgement(target: string): boolean {
  try {
    const hostname = new URL(target).hostname.toLowerCase();
    if (["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname)) return false;
    const ipv4 = hostname.split(".").map(Number);
    const privateIpv4 =
      ipv4.length === 4 &&
      ipv4.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) &&
      (ipv4[0] === 10 ||
        ipv4[0] === 127 ||
        (ipv4[0] === 192 && ipv4[1] === 168) ||
        (ipv4[0] === 172 && ipv4[1] !== undefined && ipv4[1] >= 16 && ipv4[1] <= 31));
    return !privateIpv4;
  } catch {
    return false;
  }
}

export async function acknowledgeTarget(
  target: string,
  ask: (question: string) => Promise<string>,
): Promise<boolean> {
  if (!needsRemoteAcknowledgement(target)) return false;
  const confirmed =
    (await ask("Target is public or production-like. Continue? [y/N]: ")).trim().toLowerCase() ===
    "y";
  if (!confirmed)
    throw new BayarLabError("REMOTE_TARGET_NOT_ALLOWED", "Remote target was not confirmed.");
  return true;
}

export async function launchInteractive(config: RuntimeConfig): Promise<number> {
  const terminal = createInterface({ input, output });
  const history = new SessionHistory();
  try {
    output.write("BayarLab — local-first payment webhook simulator\n");
    const provider = await askChoice(terminal.question.bind(terminal), "Choose a provider", [
      { id: "midtrans", label: "Midtrans — Classic Core API notifications" },
      { id: "xendit", label: "Xendit — Payments API v3 DANA webhooks" },
      { id: "doku", label: "DOKU — Direct API non-SNAP Mandiri VA" },
    ]);
    const adapter =
      provider === "doku" ? dokuAdapter : provider === "xendit" ? xenditAdapter : midtransAdapter;
    const scenario = await askChoice(
      terminal.question.bind(terminal),
      "Choose an event",
      adapter.listScenarios(),
    );
    const target =
      (
        await terminal.question(
          `Target URL${config.target ? ` [${redactTargetUrl(config.target, [config.midtransSecret, config.xenditCallbackToken, config.dokuSecret])}]` : ""}: `,
        )
      ).trim() || config.target;
    if (!target) throw new BayarLabError("INVALID_REQUEST", "A target URL is required.");
    const amountText = (await terminal.question(`Amount in IDR [${config.amount}]: `)).trim();
    const amount = amountText === "" ? config.amount : Number(amountText);
    const orderId = (await terminal.question("Order ID [auto]: ")).trim() || undefined;
    const invalidSignature =
      (
        await terminal.question(
          `Send invalid ${provider === "xendit" ? "callback token" : "signature"}? [y/N]: `,
        )
      )
        .trim()
        .toLowerCase() === "y";
    const allowRemoteTarget = await acknowledgeTarget(target, terminal.question.bind(terminal));
    const expectedStatusText = invalidSignature
      ? (await terminal.question("Expected rejection status [401]: ")).trim() || "401"
      : undefined;
    let lastOutput = await sendProvider(
      {
        provider,
        scenario,
        target,
        amount,
        ...(orderId === undefined ? {} : { orderId }),
        invalidSignature,
        ...(expectedStatusText === undefined ? {} : { expectStatus: Number(expectedStatusText) }),
        allowRemoteTarget,
      },
      config,
      history,
    );
    output.write(`\n${formatSend(lastOutput, "text")}\n`);

    while (true) {
      const action = (await terminal.question("[r]eplay, [i]nspect last, [h]istory, [q]uit: "))
        .trim()
        .toLowerCase();
      if (action === "q" || action === "") break;
      if (action === "i") {
        const latest = history.latest();
        if (latest)
          output.write(
            `${JSON.stringify(toDisplayResult(latest.result, [lastOutput.secret]), null, 2)}\n`,
          );
        continue;
      }
      if (action === "h") {
        history.list().forEach((record, index) => {
          output.write(
            `${index + 1}. ${record.scenario} — HTTP ${record.result.response?.status ?? "error"} — ${record.id}\n`,
          );
        });
        continue;
      }
      if (action === "r") {
        const latest = history.latest();
        if (!latest) continue;
        const replayed = await replayProvider(
          latest.request,
          lastOutput.secret,
          provider === "doku" ? "doku" : provider === "xendit" ? "xendit" : "midtrans",
          {
            ...(expectedStatusText === undefined
              ? {}
              : { expectStatus: Number(expectedStatusText) }),
            allowRemoteTarget,
          },
          config,
          history,
          scenario,
        );
        lastOutput = replayed;
        output.write(`${formatSend(lastOutput, "text")}\n`);
        continue;
      }
      output.write("Choose r, i, h, or q.\n");
    }
    return lastOutput.results.every((result) => requestSucceeded(result, lastOutput.expectedStatus))
      ? 0
      : 1;
  } finally {
    terminal.close();
  }
}
