# CLI MVP (Phase 4)

BayarLab has two CLI modes. Direct commands are suitable for scripts and CI. Starting `bayarlab` with no arguments from an interactive terminal opens a prompt for provider, event, target, amount, order ID, and invalid-signature mode. After delivery it offers replay, inspect-last, and session history. In a noninteractive shell, no arguments prints help and exits 0; `--help` and `--version` also exit 0. Unknown commands, missing arguments, and invalid options/configuration exit 2 without an implementation stack trace.

## Direct commands

```bash
bayarlab providers --output json
bayarlab inspect midtrans settlement --order-id BL-INSPECT-001 --output json
bayarlab send midtrans settlement --to http://127.0.0.1:3000/webhook
bayarlab send midtrans settlement --to http://127.0.0.1:3000/webhook \
  --repeat 2 --same-event-id
bayarlab send midtrans settlement --to http://127.0.0.1:3000/webhook \
  --invalid-signature --expect-status 401 --output json
bayarlab send doku success --to http://127.0.0.1:3000/webhook/doku
```

`--repeat 2` makes two total sequential attempts, not an original plus two extras. It requires `--same-event-id`, then sends the same already-signed bytes each time. Interactive `replay` also sends the original in-memory `WireRequest`, so provider fields and signature remain unchanged while the engine gives the delivery a new request ID. There is no persistent history or cross-process replay in V0.1.

`inspect` prepares authentication locally but does not deliver; its output masks Midtrans `signature_key`, Xendit `x-callback-token`, or DOKU `Signature`. The send command reports each attempt in plain text or emits one JSON document containing `attempts`. It exits 0 only if every result is a 2xx response, or exactly matches `--expect-status`; it exits 1 for delivery/assertion failures and 2 for input/configuration/target-policy errors.

## Configuration and safety

Precedence is command arguments, then environment values, then defaults. The V0.1 configuration is read-only and never written to disk:

| Setting | Environment variable | Default |
| --- | --- | --- |
| Target | `BAYARLAB_TARGET` | none; a target is required |
| Amount | `BAYARLAB_AMOUNT` | `150000` |
| Timeout | `BAYARLAB_TIMEOUT_MS` | `15000` ms |
| Midtrans test key | `BAYARLAB_MIDTRANS_TEST_KEY` | `bayarlab-local-test-key` |
| Xendit callback token | `BAYARLAB_XENDIT_CALLBACK_TOKEN` | `bayarlab-local-xendit-token` |
| DOKU non-SNAP client ID | `BAYARLAB_DOKU_CLIENT_ID` | `MCH-BAYARLAB-LOCAL` |
| DOKU non-SNAP secret | `BAYARLAB_DOKU_SECRET` | `bayarlab-local-doku-secret` |

Run `bayarlab config` to see effective non-secret settings and their sources. Project/global config files and writers are intentionally deferred. The CLI masks the Midtrans key, Xendit callback token, DOKU secret, authentication fields, and sensitive target query values in configuration, prompts, and inspect/send output, including encoded values. Redaction changes only the display, not the configured target or wire bytes. Direct commands need `--allow-remote-target` for public or production-labelled targets. Interactive mode asks for confirmation before such a send; local sends never enable that override implicitly and retain resolved-address checks.
