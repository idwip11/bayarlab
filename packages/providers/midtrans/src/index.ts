import { createHash, randomUUID } from "node:crypto";

import {
  BayarLabError,
  type PaymentState,
  type ProviderEvent,
  type WireRequest,
} from "@bayarlab/core";
import type {
  BuildEventInput,
  ProviderAdapter,
  ProviderConfig,
  ProviderManifest,
  ScenarioDefinition,
  SignableRequest,
  SignedProviderEvent,
  SigningConfig,
  ValidationResult,
} from "@bayarlab/provider-contract";

export type MidtransProduct = "bni-va" | "credit-card";
export type MidtransScenario = "pending" | "settlement" | "cancel" | "expire" | "capture" | "deny";

const scenarios = [
  { id: "pending", label: "BNI VA pending", product: "bni-va", state: "PENDING" },
  { id: "settlement", label: "BNI VA settled", product: "bni-va", state: "PAID" },
  { id: "cancel", label: "BNI VA cancelled", product: "bni-va", state: "CANCELLED" },
  { id: "expire", label: "BNI VA expired", product: "bni-va", state: "EXPIRED" },
  { id: "capture", label: "Credit card captured", product: "credit-card", state: "PAID" },
  { id: "deny", label: "Credit card bank-declined", product: "credit-card", state: "DENIED" },
] as const satisfies readonly ScenarioDefinition[];

const statusCodes: Record<MidtransScenario, string> = {
  pending: "201",
  settlement: "200",
  cancel: "202",
  expire: "202",
  capture: "200",
  deny: "202",
};

export const manifest: ProviderManifest = {
  provider: "midtrans",
  adapterVersion: "0.1.0",
  docsVerifiedAt: "2026-09-21",
  products: ["bni-va", "credit-card"],
  supportedScenarios: scenarios.map(({ id }) => id),
  documentationUrls: [
    "https://docs.midtrans.com/reference/bni-virtual-account-1",
    "https://docs.midtrans.com/reference/cancel-transaction",
    "https://docs.midtrans.com/reference/card-feature-full-pan",
    "https://docs.midtrans.com/docs/https-notification-webhooks",
  ],
  knownDifferences: [
    "BNI VA cancel is composed from BNI notification shape and documented cancel semantics; it is not a captured callback.",
    "Events do not exist in a Midtrans sandbox. GET Status verification needs a separate mock.",
    "No automatic provider retry schedule or redirect following is simulated.",
  ],
};

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(record: JsonRecord, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new BayarLabError("INVALID_REQUEST", `Midtrans ${key} must be a non-empty string.`);
  }
  return value;
}

function parseBody(bytes: Uint8Array): JsonRecord {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch (cause) {
    throw new BayarLabError("INVALID_REQUEST", "Midtrans body must be valid JSON.", { cause });
  }
  if (!isRecord(value)) {
    throw new BayarLabError("INVALID_REQUEST", "Midtrans body must be a JSON object.");
  }
  return value;
}

function formatWib(date: Date): string {
  return new Date(date.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 19).replace("T", " ");
}

export function computeMidtransSignature(
  orderId: string,
  statusCode: string,
  grossAmount: string,
  serverKey: string,
): string {
  return createHash("sha512")
    .update(`${orderId}${statusCode}${grossAmount}${serverKey}`, "utf8")
    .digest("hex");
}

export function corruptMidtransSignature(request: WireRequest): WireRequest {
  const body = parseBody(request.body);
  const signature = requireString(body, "signature_key");
  if (!/^[0-9a-f]{128}$/.test(signature)) {
    throw new BayarLabError(
      "INVALID_REQUEST",
      "Midtrans signature_key must be lowercase SHA-512 hex.",
    );
  }
  const changed = `${signature[0] === "0" ? "1" : "0"}${signature.slice(1)}`;
  return {
    ...request,
    headers: { ...request.headers },
    metadata: { ...request.metadata },
    body: Buffer.from(JSON.stringify({ ...body, signature_key: changed }), "utf8"),
  };
}

export class MidtransAdapter implements ProviderAdapter {
  readonly manifest = manifest;

  listScenarios(): readonly ScenarioDefinition[] {
    return scenarios.map((scenario) => ({ ...scenario }));
  }

  async buildEvent(input: BuildEventInput): Promise<ProviderEvent> {
    const scenario = scenarios.find(({ id }) => id === input.scenario);
    if (!scenario || scenario.product !== input.product) {
      throw new BayarLabError(
        "INVALID_REQUEST",
        "Unsupported Midtrans product/scenario combination.",
      );
    }
    const amount = input.amount ?? 150_000;
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new BayarLabError(
        "INVALID_REQUEST",
        "Midtrans amount must be a positive whole IDR value.",
      );
    }
    const orderId = input.orderId ?? `BL-${randomUUID().slice(0, 8)}`;
    if (!/^[A-Za-z0-9._~-]{1,50}$/.test(orderId)) {
      throw new BayarLabError(
        "INVALID_REQUEST",
        "Midtrans order ID must be 1–50 permitted characters.",
      );
    }
    const now = input.now ?? new Date();
    if (Number.isNaN(now.getTime())) {
      throw new BayarLabError("INVALID_REQUEST", "Midtrans event time is invalid.");
    }
    const transactionId = input.transactionId ?? randomUUID();
    const eventId = input.eventId ?? randomUUID();
    const body: JsonRecord = {
      transaction_time: formatWib(now),
      transaction_status: scenario.id,
      transaction_id: transactionId,
      status_message: "midtrans payment notification",
      status_code: statusCodes[scenario.id],
      payment_type: scenario.product === "bni-va" ? "bank_transfer" : "credit_card",
      order_id: orderId,
      gross_amount: amount.toFixed(2),
      currency: "IDR",
    };

    if (
      scenario.product === "bni-va" &&
      (scenario.id === "pending" || scenario.id === "settlement")
    ) {
      body.va_numbers = [{ bank: "bni", va_number: "880000000000001" }];
      body.fraud_status = "accept";
    }
    if (scenario.product === "credit-card") {
      body.fraud_status = "accept";
      body.bank = "bni";
      body.card_type = "credit";
      body.masked_card = "48111111-1114";
      body.channel_response_code = scenario.id === "capture" ? "00" : "05";
      body.channel_response_message = scenario.id === "capture" ? "Approved" : "Do not honor";
    }

    return {
      provider: "midtrans",
      product: scenario.product,
      scenario: scenario.id,
      method: "POST",
      headers: {},
      body,
      metadata: { eventId, transactionId, createdAt: now.toISOString() },
    };
  }

  async sign(request: SignableRequest, config: SigningConfig): Promise<SignedProviderEvent> {
    const validation = await this.validateConfig({ secret: config.secret });
    if (!validation.valid) {
      throw new BayarLabError("INVALID_REQUEST", validation.errors.join(" "));
    }
    const body = parseBody(request.body);
    if ("signature_key" in body) {
      throw new BayarLabError("INVALID_REQUEST", "Midtrans body is already signed.");
    }
    const orderId = requireString(body, "order_id");
    const statusCode = requireString(body, "status_code");
    const grossAmount = requireString(body, "gross_amount");
    if (!/^\d+\.\d{2}$/.test(grossAmount)) {
      throw new BayarLabError("INVALID_REQUEST", "Midtrans gross_amount must be a decimal string.");
    }
    const signature = computeMidtransSignature(orderId, statusCode, grossAmount, config.secret);
    return {
      headers: { ...request.headers },
      body: Buffer.from(JSON.stringify({ ...body, signature_key: signature }), "utf8"),
      signature: { location: "body", name: "signature_key" },
    };
  }

  async validateConfig(config: ProviderConfig): Promise<ValidationResult> {
    const valid = typeof config.secret === "string" && config.secret.length > 0;
    return { valid, errors: valid ? [] : ["Midtrans server key must be non-empty."] };
  }

  async normalize(payload: unknown) {
    if (!isRecord(payload)) {
      throw new BayarLabError("INVALID_REQUEST", "Midtrans payload must be an object.");
    }
    const status = requireString(payload, "transaction_status");
    const stateByStatus: Record<MidtransScenario, PaymentState> = {
      pending: "PENDING",
      settlement: "PAID",
      cancel: "CANCELLED",
      expire: "EXPIRED",
      capture: "PAID",
      deny: "DENIED",
    };
    if (!Object.hasOwn(stateByStatus, status)) {
      throw new BayarLabError("INVALID_REQUEST", `Unsupported Midtrans status: ${status}`);
    }
    const scenario = status as MidtransScenario;
    const paymentType = requireString(payload, "payment_type");
    const card = scenario === "capture" || scenario === "deny";
    if (
      paymentType !== (card ? "credit_card" : "bank_transfer") ||
      (card && payload.fraud_status !== "accept") ||
      (payload.fraud_status !== undefined && payload.fraud_status !== "accept")
    ) {
      throw new BayarLabError(
        "INVALID_REQUEST",
        "Unsupported Midtrans payment-type/fraud-status combination for this profile.",
      );
    }
    return {
      provider: "midtrans",
      state: stateByStatus[scenario],
      orderId: requireString(payload, "order_id"),
      transactionId: requireString(payload, "transaction_id"),
    };
  }
}

export const midtransAdapter = new MidtransAdapter();
