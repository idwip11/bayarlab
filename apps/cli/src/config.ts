import { BayarLabError } from "@bayarlab/core";

export interface RuntimeConfig {
  amount: number;
  target?: string;
  timeoutMs: number;
  midtransSecret: string;
  xenditCallbackToken: string;
  dokuClientId: string;
  dokuSecret: string;
  sources: {
    amount: "default" | "environment";
    target: "default" | "environment";
    timeoutMs: "default" | "environment";
    midtransSecret: "default" | "environment";
    xenditCallbackToken: "default" | "environment";
    dokuClientId: "default" | "environment";
    dokuSecret: "default" | "environment";
  };
}

function positiveInteger(value: string | undefined, name: string, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new BayarLabError("INVALID_REQUEST", `${name} must be a positive whole number.`);
  }
  return parsed;
}

/**
 * V0.1 intentionally reads only environment configuration. Project/global config
 * writers are deferred so BayarLab never persists a secret by accident.
 */
export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const target = env.BAYARLAB_TARGET;
  const timeout = env.BAYARLAB_TIMEOUT_MS;
  const amount = env.BAYARLAB_AMOUNT;
  const secret = env.BAYARLAB_MIDTRANS_TEST_KEY;
  const callbackToken = env.BAYARLAB_XENDIT_CALLBACK_TOKEN;
  const dokuClientId = env.BAYARLAB_DOKU_CLIENT_ID;
  const dokuSecret = env.BAYARLAB_DOKU_SECRET;
  return {
    amount: positiveInteger(amount, "BAYARLAB_AMOUNT", 150_000),
    ...(target === undefined ? {} : { target }),
    timeoutMs: positiveInteger(timeout, "BAYARLAB_TIMEOUT_MS", 15_000),
    midtransSecret: secret ?? "bayarlab-local-test-key",
    xenditCallbackToken: callbackToken ?? "bayarlab-local-xendit-token",
    dokuClientId: dokuClientId ?? "MCH-BAYARLAB-LOCAL",
    dokuSecret: dokuSecret ?? "bayarlab-local-doku-secret",
    sources: {
      amount: amount === undefined ? "default" : "environment",
      target: target === undefined ? "default" : "environment",
      timeoutMs: timeout === undefined ? "default" : "environment",
      midtransSecret: secret === undefined ? "default" : "environment",
      xenditCallbackToken: callbackToken === undefined ? "default" : "environment",
      dokuClientId: dokuClientId === undefined ? "default" : "environment",
      dokuSecret: dokuSecret === undefined ? "default" : "environment",
    },
  };
}
