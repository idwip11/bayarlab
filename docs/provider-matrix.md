# Provider capability matrix and research

Reviewed: **2026-09-21** for Midtrans, **2026-09-23** for Xendit, and **2026-09-28** for DOKU. Midtrans, Xendit, and DOKU documentation-based presets are implemented. No real sandbox callbacks have been captured. A review date is not a provider API version.

## Selected product families

| Provider / release | Selected API and product | Initial notifications | Authentication | Excluded initially |
| --- | --- | --- | --- | --- |
| Midtrans / V0.1 | Classic Core API payment notifications; BNI VA and limited credit-card profiles | Six presets in the table below | Body `signature_key` | SNAP/Open API, recurring, other banks/wallets, refund, authorization/challenge |
| Xendit / V0.3 | Payments API v3, `2024-11-11` request API baseline; Indonesia DANA, `PAY`, automatic capture | `payment.capture`, `payment.failure`; exact DANA failure fixture requires Phase 8 review | `x-callback-token` | Payment Sessions, legacy Invoice/eWallet APIs, cards, tokens, refunds, reusable payments |
| DOKU / V0.4 | Direct API non-SNAP, Mandiri Virtual Account | Successful VA payment, replay, invalid authentication | `Signature: HMACSHA256=…` | Checkout lifecycle, other banks, unsupported failure/pending/expiry callbacks, SNAP implementation |

Product choices are BayarLab decisions. Profiles constrain fixture generation, rather than implying every state is valid for every payment channel.

## Midtrans: six V0.1 presets

| CLI event | Profile / wire `payment_type` | Wire state | Body status code | Internal state | Evidence |
| --- | --- | --- | --- | --- | --- |
| `pending` | `bni-va` / `bank_transfer` | `pending` | `201` | `PENDING` | [BNI VA reference](https://docs.midtrans.com/reference/bni-virtual-account-1) |
| `settlement` | `bni-va` / `bank_transfer` | `settlement` | `200` | `PAID` | [BNI VA reference](https://docs.midtrans.com/reference/bni-virtual-account-1) |
| `expire` | `bni-va` / `bank_transfer` | `expire` | `202` | `EXPIRED` | [BNI VA reference](https://docs.midtrans.com/reference/bni-virtual-account-1) |
| `cancel` | `bni-va` / `bank_transfer` | `cancel` | `202` | `CANCELLED` | [Cancellation eligibility and notification example](https://docs.midtrans.com/reference/cancel-transaction) |
| `capture` | `credit-card` / `credit_card` | `capture`, `fraud_status=accept` | `200` | `PAID` | [Accepted capture notification](https://docs.midtrans.com/reference/card-feature-pre-authorization) |
| `deny` | `credit-card` / `credit_card` | `deny`, bank rejection with FDS acceptance | `202` | `DENIED` | [Bank rejection example](https://docs.midtrans.com/reference/card-feature-full-pan) |

The cancellation reference establishes BNI eligibility but illustrates a card cancellation notification. The BNI cancellation fixture is therefore a documented composition of BNI shape and cancellation semantics, not a captured BNI callback. Phase 3 must record that provenance and validate field presence before claiming fixture fidelity.

Use BNI notification examples, not charge-request objects or browser callback samples, as the fixture base. Preserve monetary values as decimal strings such as `150000.00` and render transaction timestamps in provider format using UTC+7 independently of the machine timezone. Optional fields vary by event; the BNI reference also identifies `payment_amounts` as legacy. [BNI notification schema](https://docs.midtrans.com/reference/bni-virtual-account-1)

Internal mappings are BayarLab conventions. Card capture is already a successful capture, not merely `AUTHORIZED`; that latter label belongs to a different card state. Do not assume every settled transaction is universally terminal: Midtrans documents channel-specific reversal behavior, which is excluded here. [Transaction status cycle](https://docs.midtrans.com/docs/transaction-status-cycle)

### Authentication and delivery fidelity

Classic notifications use lowercase hexadecimal SHA-512 of the concatenated strings `order_id + status_code + gross_amount + server_key`, stored in `signature_key`. Preserve amount formatting. This authenticates those fields, not every JSON field. [Midtrans notification guide](https://docs.midtrans.com/docs/https-notification-webhooks)

BayarLab decisions: use synthetic secrets; corrupt the signature after signing for invalid mode; never send the secret itself. Use test vectors with fixed inputs and independently computed expected values. Do not assert that changing an unsigned field must invalidate this signature.

The guide documents duplicate/out-of-order notifications and status-dependent retries: 2xx stops retries; 500 gets one, 503 four, 400/404 two, and other failures up to five. It distinguishes 301/302/303 from 307/308, which can preserve POST through at most five redirects. [Notification delivery rules](https://docs.midtrans.com/docs/https-notification-webhooks)

The guide says 15-second timeout and a two-minute first retry; the separate reference says 30 seconds and a one-minute interval for HTTP 500. Treat this as unresolved documentation inconsistency. [Guide](https://docs.midtrans.com/docs/https-notification-webhooks), [reference](https://docs.midtrans.com/reference/handle-notifications)

V0.1 policy: configurable 15-second timeout, no automatic retry, no redirect following. These are simulator defaults, not exact replication of Midtrans scheduling. Phase 6 must resolve or explicitly version any provider retry preset.

The Midtrans Open API VA notification uses a different signature contract and response semantics. It requires a separate future profile. [Open API notification](https://docs.midtrans.com/reference/payment-notification-api)

### Known limitations and Phase 3 result

- Local mock events have no corresponding provider transaction. GET Status verification and SDK helpers that invoke it need a future stub/bridge or a separately mocked transport. The provider describes GET Status as a verification option. [Handle notifications](https://docs.midtrans.com/reference/handle-notifications)
- Golden fixtures exist for each selected notification; optional fields are omitted where the reference does not establish them. Card presets simulate webhook outcomes only, without card collection, tokenization, or 3DS.
- Mark composed fixtures distinctly from provider examples and sandbox captures. Do not use documentation sample hashes as secret-backed known-good test vectors.
- Adapter metadata exposes `docsVerifiedAt`, product IDs, source URLs, adapter version, supported scenarios, and deviations. Do not label mock mode as official certification.
- The BNI `cancel` fixture remains a documented composition, not provider-captured evidence. See [implementation details](providers/midtrans.md).

## Xendit: Payments API v3

The selected v3 baseline uses `/v3/payment_requests`, `api-version: 2024-11-11`, and channel `DANA`, whereas the older eWallet contract uses different field names and channel codes. The version is associated with the request API; do not invent that header on outgoing notifications. [Official v3 migration guide](https://docs.xendit.co/v1/docs/migrate-direct-per-channel-apis-to-v3)

Payment webhooks contain `event`, `business_id`, `created`, and `data`. Capture reports `SUCCEEDED`, and failure reports `FAILED`. Preserve `payment_id`, `payment_request_id`, `reference_id`, and capture identifiers where present. The current reference includes an Indonesian DANA capture example; its failure example uses a different country/channel. DANA failure shape and failure-code applicability therefore remain a Phase 8 verification gate. [Payment webhook reference](https://docs.xendit.co/apidocs/payment-webhook-notification)

Authenticate using the shared callback token header, not a fabricated body HMAC. Documentation recommends using payment/capture identifiers for duplicate handling, accepting quickly with 2xx, and preparing for unordered delivery. It describes up to six retries with exponential backoff on failed acknowledgement. [Webhook handling](https://docs.xendit.co/docs/handling-webhooks)

A generic resource status does not imply a corresponding webhook event exists. For example, request expiry is a separate `payment_request.expiry` event. Do not invent `payment.pending` to satisfy the normalized domain. [Event catalog](https://docs.xendit.co/docs/payments-api-webhooks)

Phase 8 result: the v3 migration guide still shows `api-version: 2024-11-11` on the request API, and the current capture sample is ID/DANA. No ID/DANA failure sample or sandbox callback was found in the reviewed payment webhook reference, so the failure fixture is explicitly marked composed and omits an unverified failure code. Callback-token acceptance/rejection, stable IDs, replay bytes, and receiver tests are implemented. See [Xendit adapter details](providers/xendit.md). Defer expiry until its own resource schema is implemented. Invalid-token and duplicate variants are adapter capabilities, not extra provider payment states.

## DOKU: non-SNAP Mandiri VA

The selected sample uses `service.id=VIRTUAL_ACCOUNT`, `acquirer.id=BANK_MANDIRI`, and `channel.id=VIRTUAL_ACCOUNT_BANK_MANDIRI`, with `transaction.status=SUCCESS`, invoice/amount, VA details, and bank-specific payment identifiers. HTTP request headers include `Client-Id`, `Request-Id`, `Request-Timestamp`, and `Signature`. [Non-SNAP notification samples](https://developers.doku.com/get-started-with-doku-api/notification/http-notification-sample-non-snap)

Mandiri was chosen to keep one concrete bank schema. The BCA sample spells an identifier field differently; do not silently normalize all banks into one fixture. Only the success callback is selected. Generic discussion of `FAILED` does not establish that a Mandiri VA pending/expiry/failure callback exists.

For notification signing, compute a Base64 SHA-256 body digest, then an HMAC-SHA256 over newline-separated components in this order: Client-Id, Request-Id, Request-Timestamp, Request-Target, Digest. No trailing newline. Base64-encode the HMAC and prefix `HMACSHA256=`. The target is the merchant notification path. [Notification verification](https://developers.doku.com/get-started-with-doku-api/notification/best-practice)

Request-Target and Digest are signing components; do not assume they are required transmitted headers. The header component reference further describes how the values are constructed. [Non-SNAP signature components](https://developers.doku.com/get-started-with-doku-api/signature-component/non-snap/signature-component-from-request-header)

Phase 9 result: digest/HMAC vectors were checked independently with OpenSSL. Tests cover exact JSON bytes, UTC timestamp, encoded path, query rejection, and independent receiver rejection after changing body, path, timestamp, or secret. Query-bearing DOKU targets remain rejected because the reviewed reference does not settle query canonicalization. Changing replay destination requires a newly signed delivery; byte-preserving replay is for the same target. See [DOKU adapter details](providers/doku.md).

SNAP is deferred. Its notification documentation provides separate VA/direct-debit schemas and `X-SIGNATURE` contracts, including a distinct eWallet formula. Never apply a universal “DOKU signer” across these families. [SNAP notification samples](https://developers.doku.com/get-started-with-doku-api/notification/http-notification-sample-for-snap)

## Research limitations and follow-up ownership

| Finding | Decision now | Revisit |
| --- | --- | --- |
| Midtrans guide/reference timeout and retry mismatch | Simulator defaults explicitly labelled | Phase 6 |
| BNI cancellation shape composed from multiple references | Keep scope; record composition and field-validation gate | Phase 3 |
| Xendit DANA failure sample not channel-verified | Composed fixture, explicitly not provider-captured | Future sandbox callback validation |
| DOKU bank-specific fields and signing target details | Mandiri success fixture and encoded path signer implemented; query targets rejected | Future provider clarification/sandbox validation |
| No provider sandbox captures | Documentation-based compatible simulation only | Provider implementation and optional sandbox bridge release (V0.5) |

No provider credentials are needed to proceed with Phase 1. Real sandbox testing is a separate evidence tier; retain its date and provenance if performed later.
