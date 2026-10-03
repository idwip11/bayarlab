export type PaymentState =
  | "PENDING"
  | "AUTHORIZED"
  | "PAID"
  | "FAILED"
  | "DENIED"
  | "CANCELLED"
  | "EXPIRED"
  | "REFUNDED"
  | "PARTIALLY_REFUNDED";

export interface EventMetadata {
  eventId: string;
  transactionId?: string;
  createdAt: string;
}

export interface ProviderEvent {
  provider: string;
  product: string;
  scenario: string;
  method: "POST";
  headers: Record<string, string>;
  body: unknown;
  metadata: EventMetadata;
}

export interface ScenarioStep {
  event: string;
  product: string;
  waitMs?: number;
}

export interface Scenario {
  name: string;
  provider: string;
  steps: readonly ScenarioStep[];
}

export type DeliveryErrorCode =
  | "INVALID_TARGET"
  | "REMOTE_TARGET_NOT_ALLOWED"
  | "UNSAFE_TARGET"
  | "DNS_FAILURE"
  | "INVALID_REQUEST"
  | "REQUEST_TOO_LARGE"
  | "TIMEOUT"
  | "NETWORK_ERROR";

export class BayarLabError extends Error {
  readonly code: DeliveryErrorCode;

  constructor(code: DeliveryErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BayarLabError";
    this.code = code;
  }
}

export interface WireRequest {
  targetUrl: string;
  method: "POST";
  headers: Record<string, string>;
  body: Uint8Array;
  metadata: EventMetadata;
}

export interface DeliveryResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  truncated: boolean;
}

export interface DeliveryResult {
  requestId: string;
  targetUrl: string;
  request: WireRequest;
  response?: DeliveryResponse;
  durationMs: number;
  error?: {
    code: DeliveryErrorCode;
    message: string;
  };
}
