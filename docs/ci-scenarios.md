# CI Scenario Format — Phase 7

Run deterministic payment webhook test scenarios from YAML files. Designed for
CI pipelines and local regression testing.

## Quick Start

```bash
bayarlab test bayarlab.scenario.yaml
bayarlab test scenarios/              # all .scenario.yaml files in directory
```

## YAML Schema

```yaml
version: 1                                    # required, always 1
provider: midtrans                             # required, midtrans, xendit or doku
target: http://localhost:3000/webhooks/midtrans # required, full HTTP(S) URL

variables:                                     # optional shared values
  order_id: BL-CI-001                          # shared order ID (1–50 chars)
  transaction_id: 11111111-1111-4111-8111-111111111111 # optional stable lifecycle ID
  amount: 150000                               # positive whole IDR
  product: bni-va                              # provider product profile

deterministic:                                 # optional reproducible execution
  seed: "ci-run-1"                             # derive eventId + transactionId from seed
  timestamp: "2026-01-15T10:00:00Z"            # fixed ISO 8601 base time

steps:                                         # 1–100 steps
  - event: settlement                          # provider scenario name
    product: bni-va                            # override per-step product
    options:                                   # optional mutations
      duplicate: true                          # reuse last event's identity
      invalid_signature: true                  # corrupt signature after signing
      missing_signature: true                  # remove signature after signing
      remove_fields: [field_name]              # remove top-level fields
      set_fields: { field: "value" }           # add/replace fields
      malformed_body: true                     # break JSON after signing
    expect:                                    # optional assertions
      status: 200                              # exact HTTP status code
      body_includes: "ok"                      # substring in response body
      max_duration_ms: 5000                    # maximum delivery time
      error: TIMEOUT                           # or NETWORK_ERROR
  - wait: 1000                                 # delay in ms (0–60000)
```

## Available Scenarios (Midtrans)

| Scenario    | Product     | Payment State |
|-------------|-------------|---------------|
| pending     | bni-va      | PENDING       |
| settlement  | bni-va      | PAID          |
| cancel      | bni-va      | CANCELLED     |
| expire      | bni-va      | EXPIRED       |
| capture     | credit-card | PAID          |
| deny        | credit-card | DENIED        |

Xendit Payments API v3 DANA (`product: payments-api-v3-dana`) supports `capture` → `PAID` and `failure` → `FAILED` as alternative outcomes. The latter is a composed fixture, not a captured DANA callback. Set `BAYARLAB_XENDIT_CALLBACK_TOKEN` for the local receiver and runner. See the [capture](../examples/xendit-dana.scenario.yaml) and [failure](../examples/xendit-dana-failure.scenario.yaml) examples.

DOKU Direct API non-SNAP Mandiri VA (`product: direct-api-non-snap-mandiri-va`) supports only `success` → `PAID`. Set `BAYARLAB_DOKU_CLIENT_ID` and `BAYARLAB_DOKU_SECRET` for runner and receiver. DOKU targets with a query string are rejected. See the [Mandiri VA example](../examples/doku-mandiri-va.scenario.yaml).

## Deterministic Mode

When `deterministic.seed` is set, event IDs and transaction IDs are derived from
`SHA-256(seed + stepIndex + label)` formatted as UUID v4. This produces the same
identifiers across runs, making scenarios suitable for golden-fixture comparison.

When `deterministic.timestamp` is set, each event step receives a base timestamp
offset by 1 second per event step index, producing ordered, reproducible times.

Without deterministic config, IDs are random UUIDs and timestamps are the current time.

Non-duplicate events with a shared `variables.order_id` retain the same transaction ID across the lifecycle; `variables.transaction_id` can set it explicitly (1–64 letters, digits, or hyphens). Without a shared order/transaction variable, separate event steps generate independent orders and transaction IDs. Each distinct event still receives a fresh event ID; a duplicate reuses the previous event identity and time. For reproducible bytes across runs, set both seed and timestamp.

Unknown keys in event/wait steps (including misspelled assertions) and steps combining `event` with `wait` are rejected. Before sending the first event in a file, the runner validates the entire file, event/product combinations, signing/mutations, timeout, and target policy. Configuration failures exit 2; receiver/transport assertion failures are reported and exit 1.

## Assertions

| Field            | Description                                        |
|------------------|----------------------------------------------------|
| `status`         | Exact HTTP status code (100–599)                   |
| `body_includes`  | Substring that must appear in the complete response |
| `max_duration_ms`| Maximum delivery time in milliseconds              |
| `error`          | Transport error: `TIMEOUT` or `NETWORK_ERROR`      |

With no explicit status/error expectation, 2xx is required (same as `bayarlab send`).
Transport error expectations (`error`) cannot be combined with HTTP response assertions.

## Mutation Options

All mutations occur **after signing** without re-signing:

- `invalid_signature` — corrupt Midtrans `signature_key`, Xendit `x-callback-token`, or DOKU non-SNAP `Signature`
- `missing_signature` — remove the provider authentication field entirely
- `remove_fields` — remove top-level JSON fields
- `set_fields` — add or replace top-level JSON fields
- `malformed_body` — append invalid JSON syntax

`invalid_signature` and `missing_signature` are mutually exclusive.

## Duplicate Identity

Set `options.duplicate: true` to repeat the immediately previous event scenario with the same order ID,
transaction ID, event ID, and timestamp. This yields identical webhook bytes for idempotency handling.
It cannot be the first event or change the event scenario. Keep the same product/mutation options for exact byte equality; changing authentication or other mutations deliberately changes the bytes.

## CLI Options

```bash
bayarlab test <file>                    # file or directory
bayarlab test --output text             # human-readable (default)
bayarlab test --output json             # machine-readable JSON
bayarlab test --output junit            # JUnit XML for CI annotations
bayarlab test --timeout 30000           # override HTTP timeout
bayarlab test --seed "ci-v1"            # override deterministic seed
bayarlab test --allow-remote-target     # allow non-localhost targets
```

Each command requires the file/directory argument. JSON output for one file preserves the single report object; for a directory it is one `{ passed, summary, reports }` object with aggregate counts, not NDJSON. JUnit always emits one XML declaration and one `testsuites` root containing a `testsuite` per file with aggregate totals. Exit 1 remains set if any file's assertion fails.

## Exit Codes

| Code | Meaning                                      |
|------|----------------------------------------------|
| 0    | All scenario steps passed                    |
| 1    | At least one assertion failed                |
| 2    | Configuration, parse, or pre-delivery error  |

## Limits

- Maximum 100 steps per scenario
- Maximum 60 seconds per individual wait step
- Maximum 300 seconds total wait time per scenario
- Maximum 120 seconds HTTP timeout
- Existing 1 MiB request/response size limits apply

## GitHub Actions Example

```yaml
name: Payment Webhook Tests
on: [push, pull_request]

jobs:
  webhook-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Install dependencies
        run: npm ci

      - name: Start application
        run: npm run dev &
        env:
          PORT: 3000

      - name: Wait for server
        run: npx wait-on http://localhost:3000/health

      - name: Run BayarLab scenarios
        run: npx bayarlab test scenarios/ --output junit > test-results.xml

      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: webhook-test-results
          path: test-results.xml
```

## Example Scenarios

See `examples/scenarios/` for ready-to-use scenario files:

- `basic-settlement.scenario.yaml` — simple happy-path test
- `idempotency.scenario.yaml` — duplicate delivery test
- `signature-rejection.scenario.yaml` — signature validation test
- `lifecycle.scenario.yaml` — full pending → settlement lifecycle
