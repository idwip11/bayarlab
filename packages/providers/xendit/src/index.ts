import { randomUUID } from "node:crypto";

import { BayarLabError, type ProviderEvent, type WireRequest } from "@bayarlab/core";
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

export const XENDIT_PRODUCT = "payments-api-v3-dana";
export const XENDIT_CALLBACK_HEADER = "x-callback-token";

const scenarios = [
  { id: "capture", label: "DANA payment captured", product: XENDIT_PRODUCT, state: "PAID" },
  {
    id: "failure",
    label: "DANA payment failed (composed)",
    product: XENDIT_PRODUCT,
    state: "FAILED",
  },
] as const satisfies readonly ScenarioDefinition[];

export const manifest: ProviderManifest = {
  provider: "xendit",
  adapterVersion: "0.1.0",
  docsVerifiedAt: "2026-09-23",
  products: [XENDIT_PRODUCT],
  supportedScenarios: scenarios.map(({ id }) => id),
  documentationUrls: [
    "https://docs.xendit.co/apidocs/payment-webhook-notification",
    "https://docs.xendit.co/docs/payments-api-webhooks",
    "https://docs.xendit.co/docs/handling-webhooks",
    "https://docs.xendit.co/v1/docs/migrate-direct-per-channel-apis-to-v3",
  ],
  knownDifferences: [
    "Scoped to Payments API v3, Indonesia DANA, PAY and automatic capture; not legacy eWallet, Payment Sessions or other products.",
    "DANA payment.failure is composed from the generic Payments API failure schema; the official example uses TH/CARDS. No DANA sandbox callback was captured.",
    "The webhook has no documented event ID field; BayarLab eventId is local metadata only. Duplicate replay reuses payment_id and exact bytes.",
    "The callback token is a shared secret header, not an HMAC. No Xendit server-side transaction exists for these local events.",
    "Provider retry timing is not simulated automatically; use explicit duplicate/reliability scenarios.",
  ],
};

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(record: JsonRecord, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new BayarLabError("INVALID_REQUEST", `Xendit ${key} must be a non-empty string.`);
  }
  return value;
}

export function corruptXenditCallbackToken(request: WireRequest): WireRequest {
  const entry = Object.entries(request.headers).find(
    ([name]) => name.toLowerCase() === XENDIT_CALLBACK_HEADER,
  );
  if (!entry || !entry[1]) {
    throw new BayarLabError("INVALID_REQUEST", "Xendit callback token header is missing.");
  }
  const invalid = `${entry[1][0] === "x" ? "y" : "x"}${entry[1].slice(1)}`;
  return {
    ...request,
    headers: { ...request.headers, [entry[0]]: invalid },
    body: new Uint8Array(request.body),
    metadata: { ...request.metadata },
  };
}

export class XenditAdapter implements ProviderAdapter {
  readonly manifest = manifest;

  listScenarios(): readonly ScenarioDefinition[] {
    return scenarios.map((scenario) => ({ ...scenario }));
  }

  async buildEvent(input: BuildEventInput): Promise<ProviderEvent> {
    const scenario = scenarios.find(({ id }) => id === input.scenario);
    if (!scenario || input.product !== XENDIT_PRODUCT) {
      throw new BayarLabError(
        "INVALID_REQUEST",
        "Unsupported Xendit product/scenario combination.",
      );
    }
    const amount = input.amount ?? 150_000;
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new BayarLabError(
        "INVALID_REQUEST",
        "Xendit amount must be a positive whole IDR value.",
      );
    }
    const referenceId = input.orderId ?? `BL-${randomUUID().slice(0, 8)}`;
    if (referenceId.length < 1 || referenceId.length > 255 || /[\r\n]/.test(referenceId)) {
      throw new BayarLabError(
        "INVALID_REQUEST",
        "Xendit reference_id must be 1–255 characters without line breaks.",
      );
    }
    const now = input.now ?? new Date();
    if (Number.isNaN(now.getTime())) {
      throw new BayarLabError("INVALID_REQUEST", "Xendit event time is invalid.");
    }
    const eventId = input.eventId ?? randomUUID();
    const transactionId = input.transactionId ?? randomUUID();
    if (!/^[A-Za-z0-9-]{1,64}$/.test(eventId) || !/^[A-Za-z0-9-]{1,64}$/.test(transactionId)) {
      throw new BayarLabError(
        "INVALID_REQUEST",
        "Xendit synthetic IDs must use 1–64 letters, digits or hyphens.",
      );
    }
    const created = now.toISOString();
    const data: JsonRecord = {
      payment_id: `py-${transactionId}`,
      business_id: "603f1c4172bbe840979fd408",
      reference_id: referenceId,
      payment_request_id: `pr-${transactionId}`,
      type: "PAY",
      country: "ID",
      currency: "IDR",
      request_amount: amount,
      capture_method: "AUTOMATIC",
      channel_code: "DANA",
      status: scenario.id === "capture" ? "SUCCEEDED" : "FAILED",
      ...(scenario.id === "capture"
        ? {
            captures: [
              {
                capture_id: `cptr-${eventId}`,
                capture_timestamp: created,
                capture_amount: amount,
              },
            ],
          }
        : {}),
      payment_details: {},
      metadata: {},
      created,
      updated: created,
    };
    return {
      provider: "xendit",
      product: XENDIT_PRODUCT,
      scenario: scenario.id,
      method: "POST",
      headers: {},
      body: {
        event: scenario.id === "capture" ? "payment.capture" : "payment.failure",
        business_id: data.business_id,
        created,
        data,
      },
      metadata: { eventId, transactionId, createdAt: created },
    };
  }

  async sign(request: SignableRequest, config: SigningConfig): Promise<SignedProviderEvent> {
    const validation = await this.validateConfig({ secret: config.secret });
    if (!validation.valid) {
      throw new BayarLabError("INVALID_REQUEST", validation.errors.join(" "));
    }
    if (Object.keys(request.headers).some((key) => key.toLowerCase() === XENDIT_CALLBACK_HEADER)) {
      throw new BayarLabError(
        "INVALID_REQUEST",
        "Xendit callback token header is already present.",
      );
    }
    return {
      headers: { ...request.headers, [XENDIT_CALLBACK_HEADER]: config.secret },
      body: new Uint8Array(request.body),
      signature: { location: "header", name: XENDIT_CALLBACK_HEADER },
    };
  }

  async validateConfig(config: ProviderConfig): Promise<ValidationResult> {
    const valid =
      typeof config.secret === "string" &&
      config.secret.length > 0 &&
      !/[\r\n]/.test(config.secret);
    return {
      valid,
      errors: valid ? [] : ["Xendit callback token must be non-empty and single-line."],
    };
  }

  async normalize(payload: unknown) {
    if (!isRecord(payload) || !isRecord(payload.data)) {
      throw new BayarLabError("INVALID_REQUEST", "Xendit payment webhook must contain data.");
    }
    const event = requireString(payload, "event");
    const data = payload.data;
    const status = requireString(data, "status");
    if (
      (event !== "payment.capture" || status !== "SUCCEEDED") &&
      (event !== "payment.failure" || status !== "FAILED")
    ) {
      throw new BayarLabError(
        "INVALID_REQUEST",
        "Unsupported Xendit payment event/status combination.",
      );
    }
    if (
      requireString(data, "country") !== "ID" ||
      requireString(data, "currency") !== "IDR" ||
      requireString(data, "channel_code") !== "DANA" ||
      requireString(data, "type") !== "PAY" ||
      requireString(data, "capture_method") !== "AUTOMATIC"
    ) {
      throw new BayarLabError("INVALID_REQUEST", "Xendit event falls outside the DANA profile.");
    }
    if (requireString(payload, "business_id") !== requireString(data, "business_id")) {
      throw new BayarLabError("INVALID_REQUEST", "Xendit business IDs do not match.");
    }
    return {
      provider: "xendit",
      state: event === "payment.capture" ? ("PAID" as const) : ("FAILED" as const),
      orderId: requireString(data, "reference_id"),
      transactionId: requireString(data, "payment_id"),
    };
  }
}

export const xenditAdapter = new XenditAdapter();
