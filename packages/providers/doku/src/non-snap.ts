import { createHash, createHmac, randomUUID } from "node:crypto";

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

export const DOKU_PRODUCT = "direct-api-non-snap-mandiri-va";
const scenario = {
  id: "success",
  label: "Mandiri VA payment success",
  product: DOKU_PRODUCT,
  state: "PAID",
} as const satisfies ScenarioDefinition;

export const manifest: ProviderManifest = {
  provider: "doku",
  adapterVersion: "0.1.0",
  docsVerifiedAt: "2026-09-28",
  products: [DOKU_PRODUCT],
  supportedScenarios: [scenario.id],
  documentationUrls: [
    "https://developers.doku.com/get-started-with-doku-api/notification/http-notification-sample-non-snap",
    "https://developers.doku.com/get-started-with-doku-api/notification/best-practice",
    "https://developers.doku.com/get-started-with-doku-api/signature-component/non-snap/signature-component-from-request-header",
    "https://developers.doku.com/get-started-with-doku-api/notification/http-notification-sample-for-snap",
  ],
  knownDifferences: [
    "Only Direct API non-SNAP Mandiri Virtual Account SUCCESS notifications are implemented; SNAP requires separate payload and signing modules.",
    "The body is based on the documented Mandiri VA sample with synthetic IDs and timestamp; it is not a captured sandbox notification.",
    "Targets with a query string are rejected because the notification Request-Target query canonicalization is not established by the reviewed reference.",
    "Request-Target and Digest are signing components, not transmitted headers. No real DOKU transaction or automatic retry is created.",
  ],
};

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordField(record: JsonRecord, key: string): JsonRecord {
  const value = record[key];
  if (!isRecord(value)) {
    throw new BayarLabError("INVALID_REQUEST", `DOKU ${key} must be an object.`);
  }
  return value;
}

function stringField(record: JsonRecord, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new BayarLabError("INVALID_REQUEST", `DOKU ${key} must be a non-empty string.`);
  }
  return value;
}

export interface DokuNonSnapComponents {
  clientId: string;
  requestId: string;
  requestTimestamp: string;
  requestTarget: string;
}

/** Digest the exact outgoing JSON bytes, not a parsed/reformatted object. */
export function computeDokuNonSnapDigest(body: Uint8Array): string {
  return createHash("sha256").update(body).digest("base64");
}

export function computeDokuNonSnapSignature(
  body: Uint8Array,
  components: DokuNonSnapComponents,
  secret: string,
): string {
  const digest = computeDokuNonSnapDigest(body);
  const signedText = [
    `Client-Id:${components.clientId}`,
    `Request-Id:${components.requestId}`,
    `Request-Timestamp:${components.requestTimestamp}`,
    `Request-Target:${components.requestTarget}`,
    `Digest:${digest}`,
  ].join("\n");
  return `HMACSHA256=${createHmac("sha256", secret).update(signedText, "utf8").digest("base64")}`;
}

export function corruptDokuNonSnapSignature(request: WireRequest): WireRequest {
  const entry = Object.entries(request.headers).find(([key]) => key.toLowerCase() === "signature");
  if (!entry || !/^HMACSHA256=[A-Za-z0-9+/]{43}=$/.test(entry[1])) {
    throw new BayarLabError(
      "INVALID_REQUEST",
      "DOKU non-SNAP Signature header is missing or malformed.",
    );
  }
  const prefix = "HMACSHA256=";
  const old = entry[1][prefix.length];
  const changed = `${prefix}${old === "A" ? "B" : "A"}${entry[1].slice(prefix.length + 1)}`;
  return {
    ...request,
    headers: { ...request.headers, [entry[0]]: changed },
    body: new Uint8Array(request.body),
    metadata: { ...request.metadata },
  };
}

function dokuTimestamp(now: Date): string {
  return `${now.toISOString().slice(0, 19)}Z`;
}

export class DokuNonSnapMandiriVaAdapter implements ProviderAdapter {
  readonly manifest = manifest;

  listScenarios(): readonly ScenarioDefinition[] {
    return [{ ...scenario }];
  }

  async buildEvent(input: BuildEventInput): Promise<ProviderEvent> {
    if (input.product !== DOKU_PRODUCT || input.scenario !== scenario.id) {
      throw new BayarLabError(
        "INVALID_REQUEST",
        "Unsupported DOKU non-SNAP product/scenario combination.",
      );
    }
    const amount = input.amount ?? 150_000;
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new BayarLabError("INVALID_REQUEST", "DOKU amount must be a positive whole IDR value.");
    }
    const invoiceNumber = input.orderId ?? `BL-${randomUUID().slice(0, 8)}`;
    if (!/^[A-Za-z0-9._~-]{1,64}$/.test(invoiceNumber)) {
      throw new BayarLabError(
        "INVALID_REQUEST",
        "DOKU invoice number must use 1–64 permitted characters.",
      );
    }
    const now = input.now ?? new Date();
    if (Number.isNaN(now.getTime())) {
      throw new BayarLabError("INVALID_REQUEST", "DOKU event time is invalid.");
    }
    const eventId = input.eventId ?? randomUUID();
    const transactionId = input.transactionId ?? randomUUID();
    if (
      !/^[A-Za-z0-9._~-]{1,128}$/.test(eventId) ||
      !/^[A-Za-z0-9._~-]{1,128}$/.test(transactionId)
    ) {
      throw new BayarLabError(
        "INVALID_REQUEST",
        "DOKU synthetic IDs must use 1–128 permitted characters.",
      );
    }
    const created = dokuTimestamp(now);
    const bankTransactionId =
      `${Number.parseInt(createHash("sha256").update(transactionId).digest("hex").slice(0, 8), 16) % 10_000_000}`.padStart(
        7,
        "0",
      );
    return {
      provider: "doku",
      product: DOKU_PRODUCT,
      scenario: scenario.id,
      method: "POST",
      headers: {},
      body: {
        service: { id: "VIRTUAL_ACCOUNT" },
        acquirer: { id: "BANK_MANDIRI" },
        channel: { id: "VIRTUAL_ACCOUNT_BANK_MANDIRI" },
        transaction: {
          status: "SUCCESS",
          date: created,
          original_request_id: transactionId,
        },
        order: { invoice_number: invoiceNumber, amount },
        virtual_account_info: { virtual_account_number: "8889940000000213" },
        virtual_account_payment: {
          identifier: [
            { name: "TRANSACTION_ID", value: bankTransactionId },
            { name: "CHANNEL_ID", value: "001" },
          ],
        },
      },
      metadata: { eventId, transactionId, createdAt: created },
    };
  }

  async sign(request: SignableRequest, config: SigningConfig): Promise<SignedProviderEvent> {
    const validation = await this.validateConfig(config);
    if (!validation.valid || !config.clientId) {
      throw new BayarLabError("INVALID_REQUEST", validation.errors.join(" "));
    }
    if (!request.pathAndQuery.startsWith("/") || request.pathAndQuery.includes("?")) {
      throw new BayarLabError(
        "INVALID_TARGET",
        "DOKU non-SNAP target must have a path and no query string.",
      );
    }
    if (
      Object.keys(request.headers).some((name) =>
        ["client-id", "request-id", "request-timestamp", "signature"].includes(name.toLowerCase()),
      )
    ) {
      throw new BayarLabError(
        "INVALID_REQUEST",
        "DOKU authentication headers are already present.",
      );
    }
    const requestId = request.metadata.eventId;
    const requestTimestamp = request.metadata.createdAt;
    if (
      !/^[A-Za-z0-9._~-]{1,128}$/.test(requestId) ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(requestTimestamp)
    ) {
      throw new BayarLabError(
        "INVALID_REQUEST",
        "DOKU Request-Id or UTC Request-Timestamp is invalid.",
      );
    }
    const signature = computeDokuNonSnapSignature(
      request.body,
      {
        clientId: config.clientId,
        requestId,
        requestTimestamp,
        requestTarget: request.pathAndQuery,
      },
      config.secret,
    );
    return {
      headers: {
        ...request.headers,
        "Client-Id": config.clientId,
        "Request-Id": requestId,
        "Request-Timestamp": requestTimestamp,
        Signature: signature,
      },
      body: new Uint8Array(request.body),
      signature: { location: "header", name: "Signature" },
    };
  }

  async validateConfig(config: ProviderConfig): Promise<ValidationResult> {
    const errors: string[] = [];
    if (
      typeof config.secret !== "string" ||
      config.secret.length === 0 ||
      /[\r\n]/.test(config.secret)
    ) {
      errors.push("DOKU non-SNAP secret must be non-empty and single-line.");
    }
    if (typeof config.clientId !== "string" || !/^[A-Za-z0-9._~-]{1,128}$/.test(config.clientId)) {
      errors.push("DOKU Client-Id must use 1–128 permitted characters.");
    }
    return { valid: errors.length === 0, errors };
  }

  async normalize(payload: unknown) {
    if (!isRecord(payload)) {
      throw new BayarLabError("INVALID_REQUEST", "DOKU payload must be an object.");
    }
    const service = recordField(payload, "service");
    const acquirer = recordField(payload, "acquirer");
    const channel = recordField(payload, "channel");
    const transaction = recordField(payload, "transaction");
    const order = recordField(payload, "order");
    if (
      stringField(service, "id") !== "VIRTUAL_ACCOUNT" ||
      stringField(acquirer, "id") !== "BANK_MANDIRI" ||
      stringField(channel, "id") !== "VIRTUAL_ACCOUNT_BANK_MANDIRI" ||
      stringField(transaction, "status") !== "SUCCESS"
    ) {
      throw new BayarLabError(
        "INVALID_REQUEST",
        "DOKU event falls outside non-SNAP Mandiri VA success.",
      );
    }
    return {
      provider: "doku",
      state: "PAID" as const,
      orderId: stringField(order, "invoice_number"),
      transactionId: stringField(transaction, "original_request_id"),
    };
  }
}

export const dokuAdapter = new DokuNonSnapMandiriVaAdapter();
