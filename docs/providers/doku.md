# DOKU Direct API non-SNAP Mandiri VA — Phase 9

Reviewed 2026-09-28. BayarLab implements **one** DOKU family: Direct API **non-SNAP** Mandiri Virtual Account successful-payment HTTP notification (`product: direct-api-non-snap-mandiri-va`, scenario `success`). The payload follows the [official Mandiri VA notification example](https://developers.doku.com/get-started-with-doku-api/notification/http-notification-sample-non-snap), with synthetic invoice, IDs, amount and UTC time. It is not a captured sandbox notification and creates no real DOKU transaction.

The fixture is `packages/providers/doku/fixtures/mandiri-va-success.json`. It preserves `service.id=VIRTUAL_ACCOUNT`, `acquirer.id=BANK_MANDIRI`, `channel.id=VIRTUAL_ACCOUNT_BANK_MANDIRI`, `transaction.status=SUCCESS`, `transaction.original_request_id`, numeric `order.amount`, `virtual_account_info.virtual_account_number`, and Mandiri's `virtual_account_payment.identifier` entries. In particular, the BCA sample's misspelled `identifer` is **not** copied into Mandiri. The [VA reference](https://developers.doku.com/get-started-with-doku-api/notification/http-notification-sample-non-snap) states that VA notification is sent only when payment succeeds; Phase 9 does not invent pending, failed or expiry callbacks.

## Non-SNAP authentication

Set `BAYARLAB_DOKU_CLIENT_ID` and `BAYARLAB_DOKU_SECRET` to **local test-only** values shared with your receiver. Defaults are `MCH-BAYARLAB-LOCAL` and `bayarlab-local-doku-secret`. The outgoing notification has `Client-Id`, `Request-Id`, `Request-Timestamp`, and `Signature` headers. Request ID is BayarLab's event ID; timestamp is UTC ISO 8601 at second precision. The client ID is visible as merchant identity; the secret and signature are masked in displays.

The [official non-SNAP signing instructions](https://developers.doku.com/get-started-with-doku-api/notification/best-practice) specify:

1. Base64-encode SHA-256 of the **exact outgoing JSON bytes** to obtain `Digest`.
2. Join `Client-Id:value`, `Request-Id:value`, `Request-Timestamp:value`, `Request-Target:value`, and `Digest:value` with `\n`, without a trailing newline.
3. HMAC-SHA256 that text with the secret, Base64-encode it, and prefix `HMACSHA256=` in the `Signature` header.

`Request-Target` is the encoded path of the merchant notification URL, not a DOKU API endpoint. `Request-Target` and `Digest` are signing components, **not extra transmitted headers**. For a local known vector, body bytes `{"hello":"world"}` yield digest `k6I5cakU5erL8KjSUVTNownDwccvu5kU1Hxg88toFYg=`. With client ID `MCH-BAYARLAB-LOCAL`, request ID `22222222-2222-4222-8222-222222222222`, timestamp `2026-09-28T00:00:00Z`, target `/webhook/doku`, and the default local secret, the signature is `HMACSHA256=ePFtVvYNtbjASxjhQKr+r1czGs9WUTE2m+geqe6iZPE=`. The expected digest and HMAC were generated separately with OpenSSL and are frozen in tests. Changing body, path, timestamp or secret must fail verification.

The reviewed [Request-Target reference](https://developers.doku.com/get-started-with-doku-api/signature-component/non-snap/signature-component-from-request-header) does not settle query-string canonicalization for a merchant notification URL, so this adapter **rejects targets containing `?`**. Percent-encoded path bytes are signed as delivered. Byte-preserving replay must use the same destination path; moving a notification to a new path requires creating a new signed request, not replaying old bytes.

## Try locally

```bash
pnpm doku:receiver
pnpm --filter @bayarlab/cli start inspect doku success --to http://127.0.0.1:3000/webhook/doku
pnpm --filter @bayarlab/cli start send doku success --to http://127.0.0.1:3000/webhook/doku
pnpm --filter @bayarlab/cli start send doku success --to http://127.0.0.1:3000/webhook/doku --repeat 2 --same-event-id
pnpm --filter @bayarlab/cli start chaos doku success --to http://127.0.0.1:3000/webhook/doku --invalid-signature --expect-status 401
pnpm --filter @bayarlab/cli start test examples/doku-mandiri-va.scenario.yaml
```

The example receiver verifies the signature over raw bytes and returns 401 for invalid or missing authentication. Duplicate deliveries preserve the original body and DOKU request headers, including `Request-Id`; BayarLab still assigns a distinct local delivery ID to each attempt. The provider [recommends idempotent duplicate handling and quick 2xx acknowledgement](https://developers.doku.com/get-started-with-doku-api/notification/best-practice). No automatic retry schedule is simulated.

## SNAP boundary

This module is explicitly `non-snap.ts`; no universal DOKU signer is exported. [SNAP notifications](https://developers.doku.com/get-started-with-doku-api/notification/http-notification-sample-for-snap) use different headers and signing contracts, including `X-SIGNATURE`, and need separate future adapter modules, fixtures and tests. Do not use this signature for SNAP VA, direct debit or eWallet traffic.
