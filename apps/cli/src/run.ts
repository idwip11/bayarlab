import { BayarLabError, type DeliveryResult, type WireRequest } from "@bayarlab/core";
import { deliver, formatDelivery, prepareSignedRequest, toDisplayResult } from "@bayarlab/engine";
import { corruptDokuNonSnapSignature, dokuAdapter } from "@bayarlab/provider-doku";
import { corruptMidtransSignature, midtransAdapter } from "@bayarlab/provider-midtrans";
import { corruptXenditCallbackToken, xenditAdapter } from "@bayarlab/provider-xendit";

import type { RuntimeConfig } from "./config.js";
import type { SessionHistory } from "./history.js";

export interface SendInput {
  provider: string;
  scenario: string;
  target?: string | undefined;
  product?: string | undefined;
  orderId?: string | undefined;
  amount?: number | undefined;
  timeoutMs?: number | undefined;
  invalidSignature?: boolean | undefined;
  expectStatus?: number | undefined;
  repeat?: number | undefined;
  sameEventId?: boolean | undefined;
  allowRemoteTarget?: boolean | undefined;
}

export interface SendOutput {
  request: WireRequest;
  results: readonly DeliveryResult[];
  expectedStatus?: number;
  secret: string;
}

function requireInteger(value: number, name: string, min: number, max: number): void {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new BayarLabError(
      "INVALID_REQUEST",
      `${name} must be a whole number from ${min} to ${max}.`,
    );
  }
}

export function requestSucceeded(result: DeliveryResult, expectedStatus?: number): boolean {
  const status = result.response?.status;
  if (result.error || status === undefined) return false;
  return expectedStatus === undefined ? status >= 200 && status < 300 : status === expectedStatus;
}

export async function prepareMidtransRequest(
  input: SendInput,
  config: RuntimeConfig,
): Promise<{ request: WireRequest; secret: string }> {
  if (input.provider !== "midtrans") {
    throw new BayarLabError("INVALID_REQUEST", `Unsupported provider: ${input.provider}`);
  }
  const definition = midtransAdapter.listScenarios().find((item) => item.id === input.scenario);
  if (!definition) {
    throw new BayarLabError("INVALID_REQUEST", `Unsupported Midtrans scenario: ${input.scenario}`);
  }
  const target = input.target ?? config.target;
  if (!target)
    throw new BayarLabError(
      "INVALID_REQUEST",
      "A target URL is required (--to or BAYARLAB_TARGET).",
    );
  const amount = input.amount ?? config.amount;
  const event = await midtransAdapter.buildEvent({
    scenario: input.scenario,
    product: input.product ?? definition.product,
    amount,
    ...(input.orderId === undefined ? {} : { orderId: input.orderId }),
  });
  const signed = await prepareSignedRequest(midtransAdapter, event, target, {
    secret: config.midtransSecret,
  });
  return {
    request: input.invalidSignature === true ? corruptMidtransSignature(signed) : signed,
    secret: config.midtransSecret,
  };
}

export async function prepareProviderRequest(
  input: SendInput,
  config: RuntimeConfig,
): Promise<{ request: WireRequest; secret: string }> {
  if (input.provider === "midtrans") return prepareMidtransRequest(input, config);
  if (input.provider !== "xendit" && input.provider !== "doku") {
    throw new BayarLabError("INVALID_REQUEST", `Unsupported provider: ${input.provider}`);
  }
  const adapter = input.provider === "doku" ? dokuAdapter : xenditAdapter;
  const definition = adapter.listScenarios().find((item) => item.id === input.scenario);
  if (!definition) {
    throw new BayarLabError(
      "INVALID_REQUEST",
      `Unsupported ${input.provider} scenario: ${input.scenario}`,
    );
  }
  const target = input.target ?? config.target;
  if (!target) {
    throw new BayarLabError(
      "INVALID_REQUEST",
      "A target URL is required (--to or BAYARLAB_TARGET).",
    );
  }
  const event = await adapter.buildEvent({
    scenario: input.scenario,
    product: input.product ?? definition.product,
    amount: input.amount ?? config.amount,
    ...(input.orderId === undefined ? {} : { orderId: input.orderId }),
  });
  const secret = input.provider === "doku" ? config.dokuSecret : config.xenditCallbackToken;
  const signed = await prepareSignedRequest(adapter, event, target, {
    secret,
    ...(input.provider === "doku" ? { clientId: config.dokuClientId } : {}),
  });
  return {
    request:
      input.invalidSignature === true
        ? input.provider === "doku"
          ? corruptDokuNonSnapSignature(signed)
          : corruptXenditCallbackToken(signed)
        : signed,
    secret,
  };
}

export async function sendProvider(
  input: SendInput,
  config: RuntimeConfig,
  history?: SessionHistory,
): Promise<SendOutput> {
  if (input.provider === "midtrans") return sendMidtrans(input, config, history);
  const repeat = input.repeat ?? 1;
  requireInteger(repeat, "Repeat", 1, 100);
  if (repeat > 1 && input.sameEventId !== true) {
    throw new BayarLabError("INVALID_REQUEST", "--repeat > 1 requires --same-event-id.");
  }
  if (input.expectStatus !== undefined)
    requireInteger(input.expectStatus, "Expected status", 100, 599);
  const timeoutMs = input.timeoutMs ?? config.timeoutMs;
  requireInteger(timeoutMs, "Timeout", 1, 120_000);
  const { request, secret } = await prepareProviderRequest(input, config);
  const results: DeliveryResult[] = [];
  for (let attempt = 0; attempt < repeat; attempt += 1) {
    const result = await deliver(request, {
      timeoutMs,
      allowRemoteTarget: input.allowRemoteTarget === true,
    });
    results.push(result);
    history?.add({
      id: result.requestId,
      provider: input.provider,
      scenario: input.scenario,
      request,
      result,
    });
  }
  return {
    request,
    results,
    ...(input.expectStatus === undefined ? {} : { expectedStatus: input.expectStatus }),
    secret,
  };
}

export async function sendMidtrans(
  input: SendInput,
  config: RuntimeConfig,
  history?: SessionHistory,
): Promise<SendOutput> {
  const repeat = input.repeat ?? 1;
  requireInteger(repeat, "Repeat", 1, 100);
  if (repeat > 1 && input.sameEventId !== true) {
    throw new BayarLabError("INVALID_REQUEST", "--repeat > 1 requires --same-event-id.");
  }
  if (input.expectStatus !== undefined)
    requireInteger(input.expectStatus, "Expected status", 100, 599);
  const timeoutMs = input.timeoutMs ?? config.timeoutMs;
  requireInteger(timeoutMs, "Timeout", 1, 120_000);
  const { request, secret } = await prepareMidtransRequest(input, config);
  const results: DeliveryResult[] = [];
  for (let attempt = 0; attempt < repeat; attempt += 1) {
    const result = await deliver(request, {
      timeoutMs,
      allowRemoteTarget: input.allowRemoteTarget === true,
    });
    results.push(result);
    history?.add({
      id: result.requestId,
      provider: "midtrans",
      scenario: input.scenario,
      request,
      result,
    });
  }
  return {
    request,
    results,
    ...(input.expectStatus === undefined ? {} : { expectedStatus: input.expectStatus }),
    secret,
  };
}

export async function replayMidtrans(
  request: WireRequest,
  secret: string,
  input: Pick<SendInput, "timeoutMs" | "expectStatus" | "allowRemoteTarget">,
  config: RuntimeConfig,
  history?: SessionHistory,
  scenario = "replay",
): Promise<SendOutput> {
  return replayProvider(request, secret, "midtrans", input, config, history, scenario);
}

export async function replayProvider(
  request: WireRequest,
  secret: string,
  provider: "midtrans" | "xendit" | "doku",
  input: Pick<SendInput, "timeoutMs" | "expectStatus" | "allowRemoteTarget">,
  config: RuntimeConfig,
  history?: SessionHistory,
  scenario = "replay",
): Promise<SendOutput> {
  const timeoutMs = input.timeoutMs ?? config.timeoutMs;
  requireInteger(timeoutMs, "Timeout", 1, 120_000);
  if (input.expectStatus !== undefined)
    requireInteger(input.expectStatus, "Expected status", 100, 599);
  const result = await deliver(request, {
    timeoutMs,
    allowRemoteTarget: input.allowRemoteTarget === true,
  });
  history?.add({ id: result.requestId, provider, scenario, request, result });
  return {
    request,
    results: [result],
    ...(input.expectStatus === undefined ? {} : { expectedStatus: input.expectStatus }),
    secret,
  };
}

export function formatSend(output: SendOutput, format: "text" | "json"): string {
  if (format === "json") {
    return JSON.stringify({
      attempts: output.results.map((result) => toDisplayResult(result, [output.secret])),
      ...(output.expectedStatus === undefined ? {} : { expectedStatus: output.expectedStatus }),
    });
  }
  return output.results
    .map((result, index) => {
      const label =
        output.results.length > 1 ? `Attempt ${index + 1}/${output.results.length}\n` : "";
      return `${label}${formatDelivery(result, "text", [output.secret])}`;
    })
    .join("\n\n");
}
