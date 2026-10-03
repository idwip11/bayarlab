import type { PaymentState, ProviderEvent } from "@bayarlab/core";

export interface ProviderManifest {
  provider: string;
  adapterVersion: string;
  docsVerifiedAt: string;
  products: readonly string[];
  documentationUrls?: readonly string[];
  supportedScenarios?: readonly string[];
  knownDifferences?: readonly string[];
}

export interface ScenarioDefinition {
  id: string;
  label: string;
  product: string;
  state: PaymentState;
}

export interface BuildEventInput {
  scenario: string;
  product: string;
  orderId?: string;
  amount?: number;
  now?: Date;
  eventId?: string;
  transactionId?: string;
}

export interface SigningConfig extends ProviderConfig {
  secret: string;
  /** Provider-specific merchant identity when the signing contract requires one. */
  clientId?: string;
}

export interface SignableRequest {
  method: "POST";
  targetUrl: string;
  pathAndQuery: string;
  headers: Readonly<Record<string, string>>;
  body: Uint8Array;
  metadata: Readonly<ProviderEvent["metadata"]>;
}

export interface SignedProviderEvent {
  headers: Record<string, string>;
  body: Uint8Array;
  signature: {
    location: "body" | "header";
    name: string;
  };
}

export interface ProviderConfig {
  [key: string]: unknown;
}

export interface ValidationResult {
  valid: boolean;
  errors: readonly string[];
}

export interface NormalizedPaymentEvent {
  provider: string;
  state: PaymentState;
  transactionId?: string;
  orderId?: string;
}

export interface ProviderAdapter {
  readonly manifest: ProviderManifest;
  listScenarios(): readonly ScenarioDefinition[];
  buildEvent(input: BuildEventInput): Promise<ProviderEvent>;
  sign(request: SignableRequest, config: SigningConfig): Promise<SignedProviderEvent>;
  validateConfig(config: ProviderConfig): Promise<ValidationResult>;
  normalize?(payload: unknown): Promise<NormalizedPaymentEvent>;
}
