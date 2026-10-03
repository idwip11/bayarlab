# BayarLab product specification — V0.1

Status: Phase 0 scope baseline, 2026-09-15. Phases 1–5 are implemented as of 2026-09-22; release acceptance remains pending.

Phase 6 extension (2026-09-23): the CLI and engine now expose bounded chaos experiments and a
sequential reliability runner. See [chaos.md](chaos.md). The V0.1 baseline exclusions below remain
historical release scope; YAML/CI scenario files remain Phase 7.

This document resolves the open scope choices in the [implementation plan](../BayarLab_Implementation_Plan.md). Provider evidence and limitations live in the [provider matrix](provider-matrix.md); positioning evidence lives in [competitive notes](competitive-notes.md). Decisions below are BayarLab design decisions unless attributed to a provider source.

## Product and audience

BayarLab is a local payment webhook testing tool for Indonesian developers. It generates synthetic provider-compatible notifications, authenticates them with local test credentials, sends them to a developer's endpoint, and shows the result.

Primary user: a backend or full-stack developer implementing a Midtrans webhook receiver. Secondary user: QA engineers needing reproducible requests. The first release optimizes three jobs: send a successful event, repeat it to inspect idempotency, and corrupt authentication to inspect rejection.

Working name: BayarLab. Tagline: “Local-first payment webhook simulator for Indonesian developers.” Public claims must name the implemented provider/product coverage. Xendit and DOKU stay labelled as roadmap items until released.

The value hypothesis is that maintained fixtures and authentication reduce preparation work compared with manually maintaining requests. Desk research supports technical feasibility and competitive positioning; no interviews, usability sessions, or sandbox compatibility runs have taken place.

## Locked MVP scope

V0.1 includes the classic Midtrans Core API payment notification family, with six presets:

| Scenario command | Product profile | Intended normalized state |
| --- | --- | --- |
| `pending` | `bni-va` | `PENDING` |
| `settlement` | `bni-va` | `PAID` |
| `cancel` | `bni-va` | `CANCELLED` |
| `expire` | `bni-va` | `EXPIRED` |
| `capture` | `credit-card` | `PAID`, accepted capture only |
| `deny` | `credit-card` | `DENIED`, bank rejection preset |

These are independent notification presets. Six states do not form one cross-product lifecycle. The default profile follows the selected scenario; an explicit incompatible `--product` must fail with the supported choices. The provider matrix records the source basis for each preset. Refund, generic `failure`, card authorization/challenge, partial refunds, and additional banks are deferred.

Required capabilities:

- Interactive CLI, direct `send`, offline `inspect`, `providers`, and `ui` commands.
- Valid local signatures and a deliberately invalid-signature variant for every preset.
- Immediate duplicate delivery and replay using the original signed payload.
- Request and response inspection, HTTP status, elapsed time, and useful transport errors.
- A basic local dashboard with scenario/product selection, target, editable supported variables, payload preview, send, replay, duplicate, invalid signature, request/response tabs, and copy as cURL.
- In-memory history for the active interactive CLI or dashboard session.
- Plain terminal output and structured JSON for direct commands.
- Tests, a synthetic receiver example, installation instructions, and documented limitations.

Excluded from V0.1: Xendit/DOKU execution, real provider API calls, payment creation, GET Status emulation, Snap checkout or browser callbacks, SNAP/Open API notifications, automatic provider retries, YAML runner, delay/out-of-order/burst/malformed-body tooling, arbitrary payload editing, persistent history, cloud features, accounts, telemetry, and real money processing.

## First-run and command behavior

`npx bayarlab` opens an interactive terminal session when attached to a TTY. It does not silently start the dashboard. In a noninteractive environment, an argument-free invocation prints help and exits without sending. `bayarlab ui` explicitly starts the dashboard and prints its local URL.

Implemented direct-command examples:

```bash
bayarlab send midtrans settlement --to http://localhost:3000/webhook \
  --amount 150000 --order-id BL-DEMO-001

bayarlab send midtrans settlement --to http://localhost:3000/webhook \
  --repeat 2 --same-event-id

bayarlab send midtrans settlement --to http://localhost:3000/webhook \
  --invalid-signature --expect-status 401 --output json
```

`--repeat 2 --same-event-id` means two total attempts of the same event, not an original plus two duplicates. V0.1 rejects `--repeat > 1` without `--same-event-id`; creating multiple distinct transactions is outside this shortcut. Attempts execute sequentially and all results remain visible.

Replay exists inside the interactive session and dashboard. Standalone CLI processes do not share in-memory history; a cross-process `history replay` command is deferred. Editing amount/order creates a newly built and signed event. Replay does not regenerate it.

Default direct-send success means HTTP 2xx. `--expect-status` changes that assertion to an exact HTTP code. Invalid-signature mode alone never assumes rejection succeeded. Exit codes: `0` all HTTP expectations matched; `1` response mismatch or transport failure; `2` usage/configuration/target-policy error before sending. JSON goes to stdout as one result document; diagnostics go to stderr without prompts or terminal escape sequences.

An HTTP 200 response proves acknowledgement, not a database update. BayarLab must not label idempotency or payment processing as passed based solely on the response; the example receiver exposes observable state for acceptance tests.

## Event, authentication, and replay boundaries

- An adapter declares provider, product profiles, supported scenarios, documentation references, and review date. Unsupported combinations fail before network activity.
- Domain states are internal labels. Preserve provider fields and never add a fabricated provider `event_id` merely to fit the domain model.
- Keep transaction identity, logical event identity, and delivery-attempt identity distinct. Replay retains transaction/event identity and assigns a new internal delivery ID.
- Inject clock and ID generation from the start. Identical explicit inputs, clock, seed, and adapter version must produce identical request bytes; normal interactive sessions can use fresh IDs.
- The engine prepares the effective destination and serialized body before authentication. Authentication receives method, target path, headers, and body bytes; it may return body or header changes according to its provider contract. The transmitted body must match the final signed representation.
- Store the unredacted synthetic wire request in process memory for replay. Create separate redacted display/export representations. A redacted body must never become the replay source.
- Keep HTTP acknowledgement separate from provider transaction status and later scenario assertions.

These constraints shape Phase 1's conceptual interfaces; detailed TypeScript design belongs to Phases 1–2.

## Local operation and defaults

Defaults are BayarLab policy, not claims about provider delivery behavior:

| Setting | V0.1 decision |
| --- | --- |
| Target | User supplies an explicit full HTTP(S) URL before sending |
| Test secret | `bayarlab-local-test-key`; receiver must use the same test value |
| Amount | Positive whole rupiah input, decimal-safe conversion; default 150000 |
| Timeout | 15 seconds, configurable; no automatic retries |
| Redirects | Capture 3xx without following |
| Request limit | 1 MiB serialized body; reject before send |
| Response capture limit | 1 MiB; mark truncation and stop reading safely |
| Session history | Most recent 100 bounded records; show eviction behavior |
| Dashboard | Bind `127.0.0.1:8787`; explain port conflicts |
| Persistence | None for history or secrets in V0.1 |

Configuration for V0.1 is CLI arguments > environment variables > defaults. Implemented environment values are `BAYARLAB_TARGET`, `BAYARLAB_AMOUNT`, `BAYARLAB_TIMEOUT_MS`, and `BAYARLAB_MIDTRANS_TEST_KEY`; inspect them safely with `bayarlab config`. Project/global config files and config writers are deferred. Use `BAYARLAB_MIDTRANS_TEST_KEY` for custom local secrets rather than printing secrets in examples.

Allow loopback and private development addresses after URL/address validation. Public destinations require an explicit interactive confirmation or `--allow-remote-target` in headless mode. Validate resolved addresses, reject unsupported schemes, embedded credentials, and cloud metadata destinations. Production-labelled hostnames require explicit acknowledgement even on a private network. Define and test the exact hostname rules in Phase 2; hostname naming cannot reliably determine the actual environment.

The local dashboard API must restrict browser origins and Host headers and protect state-changing requests with a per-session token; it must not expose an unrestricted network sender to arbitrary websites. Display responses as inert text. Mask secrets, auth headers, `signature_key`, and sensitive URL values in default views and logs. Copy-as-cURL defaults to a redacted template; explicit local reveal/copy can use synthetic authentication for a runnable request. No silent external data transmission.

## Acceptance and verification

| ID | Test and observable result |
| --- | --- |
| MVP-01 | Clean packaged installation provides CLI help and bundled dashboard assets without development workspace dependencies. |
| MVP-02 | With the synthetic receiver running, a fresh user sends the default settlement and sees request, response, signature-presence indicator, and latency. Measure both install-to-first-event and ready-to-run-to-first-event; target under 60 seconds and report download time separately. |
| MVP-03 | All six presets have source-backed fixture snapshots and correct profile selection; incompatible combinations fail before sending. |
| MVP-04 | An independently calculated signature vector agrees with the signer; the receiver accepts a valid event and rejects a corrupted signature with the configured expected status. |
| MVP-05 | Replaying and duplicating preserve signed body bytes and provider identifiers; delivery IDs differ; the example receiver's fulfillment count remains one. |
| MVP-06 | Timeout, connection failure, 4xx/5xx, redirect, and oversized-response cases produce bounded, inspectable results and the documented exit behavior. |
| MVP-07 | Noninteractive execution never hangs for input; JSON parses without terminal decoration; unexpected 200 in a rejection test fails its assertion. |
| MVP-08 | Remote-target policy, dashboard-origin controls, and redaction have focused tests; configuration is never sent to BayarLab infrastructure. |
| MVP-09 | CLI works without the dashboard; session replay works in each interface and history disappears on session exit. |
| MVP-10 | Lint, strict type checking, meaningful unit/integration tests, build, clean-tarball smoke test, and supported OS checks pass. |

Merchant SDK helpers that call the real Midtrans status endpoint cannot validate these synthetic transactions. The example must verify the notification locally. Document this limitation in onboarding.

## Release and implementation sequence

V0.1 release gate follows Phases 1–5, including the acceptance tests above and essential packaging/security/docs work. Broad open-source hardening remains Phase 10. V0.2 adds Phases 6–7; Xendit follows in V0.3, DOKU in V0.4, and the optional sandbox bridge in V0.5.

This resolves the plan's overlaps: duplicate and invalid signature are already MVP features; advanced chaos and YAML remain later. Six presets meet the 5–7 requirement. Refund is optional future coverage. The argument-free launcher is terminal-first; dashboard startup is explicit. Persistent history and executable config are not V0.1 requirements.

## Phase 0 completion and handoff

- [x] Positioning and primary user selected.
- [x] Current official provider documentation inspected; exact starting families selected.
- [x] Provider matrix includes authentication, coverage, differences, and research follow-ups.
- [x] Competitor overlap documented without unsupported exclusivity claims.
- [x] V0.1 scope, exclusions, and acceptance criteria locked for implementation.

Next ticket: **BL-001 — Bootstrap monorepo and provider contract**, as specified in the implementation plan. Use pnpm, strict TypeScript, Biome, Vitest, a minimal CLI binary, package boundaries, and CI. Select a currently supported Node LTS and compatible dependency versions during Phase 1. This research does not validate the plan's older Node 20 floor.

External user validation remains future work: observe at least three developers completing the three core flows, record completion time and confusion points, and compare against their existing testing workflow. This is a proposed validation protocol, not evidence of product demand.
