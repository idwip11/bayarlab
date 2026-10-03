import { createHmac, randomUUID } from "node:crypto";

import type { ProviderEvent } from "@bayarlab/core";
import type {
  BuildEventInput,
  ProviderAdapter,
  ProviderConfig,
  SignableRequest,
  SignedProviderEvent,
  SigningConfig,
  ValidationResult,
} from "@bayarlab/provider-contract";

/**
 * A synthetic test adapter. Its signature is BayarLab-specific and makes no
 * claim to match Midtrans, Xendit, or DOKU authentication.
 */
export class DemoAdapter implements ProviderAdapter {
  readonly manifest = {
    provider: "demo",
    adapterVersion: "0.1.0",
    docsVerifiedAt: "2026-09-21",
    products: ["synthetic"],
  };

  listScenarios() {
    return [
      { id: "paid", label: "Synthetic payment paid", product: "synthetic", state: "PAID" as const },
    ];
  }

  async buildEvent(input: BuildEventInput): Promise<ProviderEvent> {
    if (input.scenario !== "paid" || input.product !== "synthetic") {
      throw new Error("Demo adapter supports only synthetic/paid.");
    }
    const eventId = input.eventId ?? randomUUID();
    const transactionId = input.transactionId ?? randomUUID();
    const createdAt = (input.now ?? new Date()).toISOString();
    return {
      provider: "demo",
      product: "synthetic",
      scenario: "paid",
      method: "POST",
      headers: {},
      body: {
        event_id: eventId,
        transaction_id: transactionId,
        order_id: input.orderId ?? "BL-DEMO-001",
        amount: input.amount ?? 150000,
        status: "paid",
        created_at: createdAt,
      },
      metadata: { eventId, transactionId, createdAt },
    };
  }

  async sign(request: SignableRequest, config: SigningConfig): Promise<SignedProviderEvent> {
    const signature = createHmac("sha256", config.secret)
      .update(request.pathAndQuery)
      .update(".")
      .update(request.body)
      .digest("hex");
    return {
      headers: { ...request.headers, "x-bayarlab-signature": signature },
      body: new Uint8Array(request.body),
      signature: { location: "header", name: "x-bayarlab-signature" },
    };
  }

  async validateConfig(config: ProviderConfig): Promise<ValidationResult> {
    return {
      valid: typeof config.secret === "string" && config.secret.length > 0,
      errors:
        typeof config.secret === "string" && config.secret.length > 0
          ? []
          : ["Demo signing secret must be non-empty."],
    };
  }

  async normalize(payload: unknown) {
    if (typeof payload !== "object" || payload === null) {
      throw new Error("Invalid demo payload.");
    }
    const record = payload as Record<string, unknown>;
    if (record.status !== "paid") throw new Error("Unsupported demo status.");
    return {
      provider: "demo",
      state: "PAID" as const,
      transactionId: String(record.transaction_id),
      orderId: String(record.order_id),
    };
  }
}

export const demoAdapter = new DemoAdapter();
