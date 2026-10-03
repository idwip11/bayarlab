# Chaos & Reliability Engine — Phase 6

Run after building the workspace. The receiver example can run in another terminal with
`pnpm midtrans:receiver`. Use a local test key shared with your receiver.

```bash
pnpm --filter @bayarlab/cli start chaos midtrans settlement --to http://127.0.0.1:3000/webhook --duplicate 3
pnpm --filter @bayarlab/cli start chaos midtrans settlement --to http://127.0.0.1:3000/webhook --delay 500
pnpm --filter @bayarlab/cli start chaos midtrans settlement --to http://127.0.0.1:3000/webhook --invalid-signature --expect-status 401
pnpm --filter @bayarlab/cli start chaos midtrans settlement --to http://127.0.0.1:3000/webhook --missing-signature --expect-status 400
pnpm --filter @bayarlab/cli start chaos midtrans settlement --to http://127.0.0.1:3000/webhook --malformed-body --expect-status 400
pnpm --filter @bayarlab/cli start chaos midtrans settlement --to http://127.0.0.1:3000/webhook --set-field 'gross_amount="1.00"' --expect-status 401
pnpm --filter @bayarlab/cli start chaos midtrans lifecycle --to http://127.0.0.1:3000/webhook --out-of-order --output json
```

These expected statuses match the sample receiver, not a universal Midtrans receiver requirement.
`--duplicate 3` means three total deliveries per step. Each uses the same signed bytes and event identity,
with a new delivery ID. `--delay` waits before each attempt; elapsed HTTP time excludes this wait.
The lifecycle preset is BNI VA pending → settlement. It shares order ID, transaction ID, amount and
transaction time; distinct event IDs represent distinct statuses. Out-of-order reverses delivery to
settlement → pending without changing the events.

All payload mutations occur **after signing** without re-signing:

- `--remove-field field...` removes top-level fields.
- `--set-field 'field=JSON'...` adds/replaces fields, including wrong types, amount and ID changes.
- `--invalid-signature` corrupts one character; `--missing-signature` removes the field.
- `--malformed-body` appends invalid JSON syntax after other mutations.

Missing and invalid signature flags are mutually exclusive. Signature and payload mutations cannot
target the same field in one run. Nested arbitrary editing is not supported. Midtrans authenticates only
order_id, status_code, and gross_amount: changing an unsigned field can leave the signature valid.

Response assertions support exact HTTP status (`--expect-status`), text containment in a complete response
(`--expect-body`), maximum delivery time (`--max-duration`), or a transport failure
(`--expect-error TIMEOUT` / `NETWORK_ERROR`). With no explicit status/error expectation, 2xx is required.
An invalid-signature test does not automatically pass: specify the rejection status expected from your receiver.
Truncated responses cannot satisfy a body-containment assertion. PASS concerns response assertions only;
inspect receiver state to establish idempotency or correct lifecycle processing.

Runs execute sequentially and continue after assertion failures, retaining results. All steps and target
policies are validated before the first send. Limits: 100 total attempts, 60 seconds delay per attempt,
300 seconds total injected delay, 120 seconds HTTP timeout, and existing 1 MiB request/response limits.
Public targets still require `--allow-remote-target`. No automatic retries or exact provider scheduling
are implied. Ctrl+C stops the CLI process.

Text and JSON output use redacted display copies; malformed request bodies are omitted from output because
field-based redaction cannot reliably parse them. Wire bytes remain in the report for in-process replay.
Exit codes: 0 all assertions matched, 1 assertion/transport mismatch, 2 configuration or pre-delivery error.

The engine exports `mutateRequest`, `assertResponse`, and `runReliabilityScenario`.
Xendit DANA `capture` and `failure` are also available as separate chaos presets. `--invalid-signature` and `--missing-signature` mutate the `x-callback-token` header, never a fabricated body HMAC. `lifecycle` and `--out-of-order` remain Midtrans-only because a single DANA attempt cannot both capture and fail. See [Xendit adapter details](providers/xendit.md).
DOKU non-SNAP Mandiri VA `success` is available as one chaos preset. The invalid/missing flags mutate the `Signature` header **after** signing; payload mutations leave the old digest/signature so a verifying receiver should reject them. Do not use the non-SNAP signer for SNAP traffic. See [DOKU adapter details](providers/doku.md).
The runner accepts prepared wire requests, per-step mutation/delay/copies/assertions, reverse ordering,
and an optional AbortSignal (checked between attempts and during delay). An active HTTP attempt remains
bounded by its timeout. YAML authoring and CI scenario files belong to Phase 7. Phase 6 is exposed through
the CLI and reusable engine API; the existing dashboard continues to provide its Phase 5 controls.
