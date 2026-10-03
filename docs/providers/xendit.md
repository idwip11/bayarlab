# Xendit Payments API v3 DANA adapter — Phase 8

Reviewed 2026-09-23. This adapter simulates **Payments API v3 payment webhooks** for an Indonesia DANA `PAY` payment with `AUTOMATIC` capture. It does not call Xendit or create a real sandbox payment. The selected product ID is `payments-api-v3-dana`.

## Contract and fixture provenance

| Scenario | Event | Data status | BayarLab state | Evidence |
| --- | --- | --- | --- | --- |
| `capture` | `payment.capture` | `SUCCEEDED` | `PAID` | [Official webhook sample](https://docs.xendit.co/apidocs/payment-webhook-notification) includes `country: ID`, `currency: IDR`, `channel_code: DANA` and captures. BayarLab's IDs, amount and time are synthetic. |
| `failure` | `payment.failure` | `FAILED` | `FAILED` | **Composed fixture**, not a DANA callback capture. The [official failure example](https://docs.xendit.co/apidocs/payment-webhook-notification) uses `TH`/`CARDS`; [event catalog](https://docs.xendit.co/docs/payments-api-webhooks) defines `payment.failure` for failed collection. BayarLab applies the generic payment shape to ID/DANA and omits the unverified channel-specific `failure_code`. |

Golden fixtures live in `packages/providers/xendit/fixtures/notifications.json`. The documented envelope is `event`, `business_id`, `created`, and `data`. The adapter keeps `payment_id`, `payment_request_id`, `reference_id`, and `capture_id` when a capture exists. `payment_id` and `payment_request_id` are derived from one synthetic transaction ID; the capture ID derives from the local event ID. The local event ID is **not** injected into the webhook because this reference does not document a wire event-ID field. A payment attempt has either capture or failure here; do not run them as sequential lifecycle states of the same attempt.

The [v3 migration guide](https://docs.xendit.co/v1/docs/migrate-direct-per-channel-apis-to-v3) uses `/v3/payment_requests`, `type: PAY`, `channel_code: DANA` and `api-version: 2024-11-11` for the **request API**. BayarLab sends a webhook to your receiver, so it deliberately does not add `api-version` to the callback headers.

## Authentication vectors

Xendit documents an `x-callback-token` header for sender verification. It is a shared secret sent as the header value, **not a body HMAC**. Compare the received header with the token configured for your receiver; keep it secret. `--invalid-signature` changes one character of the token after request preparation; `--missing-signature` in `chaos`/YAML removes the header. The JSON body stays byte-identical in both cases.

| Header value at receiver | Expected local verification result |
| --- | --- |
| Exact configured token | Accept |
| One-character-changed token | Reject |
| Header absent | Reject |

Set `BAYARLAB_XENDIT_CALLBACK_TOKEN` to the same **test-only** value in BayarLab and your local receiver. If unset, BayarLab uses `bayarlab-local-xendit-token`. `bayarlab config` and formatted results mask the token; raw in-memory wire requests naturally contain it. Do not use a live Xendit callback token in a shared log or artifact.

## Try locally

```bash
bayarlab providers --output json
bayarlab inspect xendit capture --output json
bayarlab send xendit capture --to http://127.0.0.1:3000/webhook
bayarlab send xendit capture --to http://127.0.0.1:3000/webhook --repeat 2 --same-event-id
bayarlab chaos xendit failure --to http://127.0.0.1:3000/webhook --missing-signature --expect-status 401
bayarlab test examples/xendit-dana.scenario.yaml
bayarlab test examples/xendit-dana-failure.scenario.yaml
```

The local receiver must verify `x-callback-token` to make the negative tests meaningful. Repeated sends and chaos copies reuse exact signed request bytes and provider IDs, while each HTTP attempt receives a new BayarLab delivery ID. Xendit [recommends using `payment_id` and `capture_id` for duplicate handling](https://docs.xendit.co/docs/handling-webhooks). The same guide recommends quick 2xx acknowledgement, describes retries on failed acknowledgement, and warns that webhook order is not guaranteed. BayarLab does not mimic Xendit's retry schedule or create a real provider transaction.

## Scope boundary

Legacy Invoice/eWallet callbacks, Payment Sessions, cards, reusable tokens, refunds and `payment_request.expiry` require distinct future profiles. The latter is a different resource event, not `payment.pending` or a DANA failure. The composed failure fixture needs a real DANA sandbox callback before claiming channel-specific fidelity.
