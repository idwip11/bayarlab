# Midtrans adapter (Phase 3)

Scope: Classic Core API HTTP payment notifications for BNI virtual account (`bni-va`) and credit-card (`credit-card`) outcomes. This is a documentation-based simulator, not a Midtrans sandbox callback or official certification. Source review: 2026-09-21. The [provider matrix](../provider-matrix.md) records the scope decision.

| Command scenario | Product | `transaction_status` | `status_code` | Internal state |
| --- | --- | --- | --- | --- |
| `pending` | `bni-va` | `pending` | `201` | `PENDING` |
| `settlement` | `bni-va` | `settlement` | `200` | `PAID` |
| `cancel` | `bni-va` | `cancel` | `202` | `CANCELLED` |
| `expire` | `bni-va` | `expire` | `202` | `EXPIRED` |
| `capture` | `credit-card` | `capture` | `200` | `PAID` |
| `deny` | `credit-card` | `deny` | `202` | `DENIED` |

The BNI pending, settlement, and expire shapes use the [BNI VA notification examples](https://docs.midtrans.com/reference/bni-virtual-account-1). The BNI cancel fixture is a **composition**: the [cancel reference](https://docs.midtrans.com/reference/cancel-transaction) states that eligible BNI pending transactions can be cancelled but shows a card notification. We combine its `cancel`/`202` semantics with the minimal BNI bank-transfer fields; we do not claim a BNI cancel callback was captured. Card capture and bank-decline fields are scoped to [card notification examples](https://docs.midtrans.com/reference/card-feature-full-pan) and the [transaction status cycle](https://docs.midtrans.com/docs/transaction-status-cycle). Static card/VA values are synthetic. No card PAN or merchant key is included.

Golden unsigned bodies are stored in [`fixtures/notifications.json`](../../packages/providers/midtrans/fixtures/notifications.json). Each case is tested at fixed UTC time, amount, order ID, event ID, and transaction ID. `gross_amount` remains a two-decimal string; transaction time is rendered at UTC+7. The generated body retains the Midtrans `transaction_status`; normalized states are BayarLab's internal mapping. Omitted optional fields are not asserted to be absent in real Midtrans traffic. In particular, the BNI settlement reference includes legacy `payment_amounts`, which BayarLab does not emit.

Normalization is intentionally limited to the table above: capture/deny require `payment_type: credit_card` and `fraud_status: accept`; the other supported statuses require `bank_transfer`. Any supplied non-accepted fraud outcome is rejected with `INVALID_REQUEST`, including challenged/denied capture, rather than being mislabeled `PAID`. This is a scoped simulator mapping, not a universal interpreter for every Midtrans payment/fraud state.

The [Classic notification guide](https://docs.midtrans.com/docs/https-notification-webhooks) defines `signature_key` as lowercase hex SHA-512 of `order_id + status_code + gross_amount + server_key`. The signer reads the serialized body and appends that field. It does not create a signature header. The test vectors in `index.test.ts` were computed independently with `shasum -a 512`; one uses synthetic values and one uses the publicly documented input values from [Receiving Notifications](https://docs.midtrans.com/reference/receiving-notifications). Neither treats a documentation sample hash as a secret-backed oracle. `--invalid-signature` changes one hex character **after** signing and leaves the rest of the body unchanged. Since this formula covers only three payload fields plus the secret, changing an unrelated field need not invalidate the signature.

Use a local key shared by the CLI and receiver through `BAYARLAB_MIDTRANS_TEST_KEY`; otherwise both default to `bayarlab-local-test-key`. Do not use a production key. BayarLab does not send the key to the receiver. The CLI masks signatures in formatted output. Direct send defaults to local/private targets; remote or production-labelled destinations require explicit opt-in. A non-2xx response fails the command unless `--expect-status` specifies the expected code.

Limitations: these synthetic events do not correspond to real transactions, so a receiver that calls Midtrans GET Status will need a separately mocked status endpoint. There is no provider retry scheduler, redirect following, or true sandbox capture. The sample receiver demonstrates signature verification and duplicate acknowledgement; `GET /state` exposes counts of valid deliveries, unique events, and duplicates. The Phase 4 CLI supports direct duplicate delivery and an in-session byte-preserving replay; history disappears when the process exits.
