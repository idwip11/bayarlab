# BayarLab — Detailed Implementation Plan

> **Working name:** BayarLab  
> **Tagline:** Local-first payment webhook simulator for Indonesian developers.  
> **Repository target:** `bayarlab/bayarlab` or `<your-github-username>/bayarlab`  
> **Primary interface:** CLI + local web dashboard  
> **Initial providers:** Midtrans → Xendit → DOKU  
> **Primary users:** Backend engineers, full-stack engineers, QA/SDET, indie hackers, students, and engineering teams integrating Indonesian payment gateways.  
> **Document date:** 2026-09-15

> **Phase 0 completed — 2026-09-15:** Implementation scope is now defined in
> [Product specification](docs/product-spec.md), with research in
> [Provider matrix](docs/provider-matrix.md) and
> [Competitive notes](docs/competitive-notes.md).
> These documents resolve the initial plan's open choices: six Midtrans presets,
> terminal-first default launcher, explicit dashboard command, session history,
> and basic duplicate/invalid-signature support in V0.1. Provider retry timing,
> persistent config/history, and advanced chaos remain outside the MVP.
> Phase 0 covers desk research and scope definition; user and sandbox validation
> have not been performed. Next implementation ticket: BL-001 (Phase 1).

> **Phase 1 completed — 2026-09-15:** BL-001 establishes the pnpm workspace,
> strict TypeScript build graph, Biome, Vitest, Changesets, a basic `bayarlab`
> CLI binary, the provider contract, Midtrans metadata placeholder, and a
> Node 22/24 GitHub Actions matrix. Local verification passed with `pnpm lint`,
> `pnpm typecheck`, `pnpm test`, `pnpm build`, and CLI help/provider smoke tests.
> Next implementation ticket: Phase 2 core domain and delivery engine.

> **Phase 2 completed — 2026-09-21:** Normalized domain and scenario types,
> revised provider signing contract, byte-preserving request preparation,
> HTTP delivery engine, response capture and limits, timeout handling,
> target validation, redacted output, typed errors, and a signed synthetic
> demo provider are implemented. Unit and localhost HTTP integration tests,
> build, and a live CLI-to-demo-receiver smoke test passed. Details are in
> [Architecture](docs/architecture.md). Next: Phase 3 Midtrans adapter.

> **Phase 7 completed — 2026-09-23:** CI Scenario Format implemented in
> `packages/scenario` and integrated into the CLI via `bayarlab test <file|dir>`.
> Features include YAML schema with Zod validation, bounded execution limits,
> deterministic clock (`deriveTimestamp`) and ID generation (`deriveId`),
> response assertions (status, body substring, max duration, transport error),
> exit codes (0 = pass, 1 = failure, 2 = config/parse error), machine-readable
> reporting (`text`, `json`, `junit`), and GitHub Actions workflow template.
> Verified with unit/integration tests and monorepo typecheck/lint.
> Reference: [docs/ci-scenarios.md](docs/ci-scenarios.md).

> **Phase 11 audit completed — 2026-10-03:** Findings and release gates are in
> [Release candidate audit](docs/release-candidate-audit.md). **RC-001–RC-013 are
> remediated and locally verified**: 130 tests, build/typecheck/lint, clean frozen
> install at exact Node 22.13.0, independent installed-tarball/dashboard smoke,
> and zero full/runtime dependency advisories. The `bayarlab` 0.1.0 candidate
> bundles private internal packages and dashboard assets; MIT was selected by
> the maintainer. Public release approval still requires an identifiable commit
> and passing Ubuntu/macOS/Windows × Node 22.13.0/22/24 CI before Phase 12.
> No package was published or candidate commit created automatically.

---

## 1. Product Thesis

BayarLab is **not a payment gateway** and does not process real money.

BayarLab is a developer tool that lets engineers reproduce payment-provider webhook behavior locally without repeatedly creating sandbox transactions, exposing localhost, navigating provider dashboards, or manually editing JSON payloads.

The core promise:

```bash
npx bayarlab
```

Then:

```text
Provider   : Midtrans
Scenario   : Payment settled
Target URL : http://localhost:3000/api/payment/webhook

SEND

✓ Payload generated
✓ Signature generated
✓ POST sent
✓ HTTP 200
✓ Response time 87 ms
```

The developer should be able to go from installation to first successful simulated webhook in **under 60 seconds**.

---

# 2. Why This Product Should Exist

Payment webhook integration has several recurring engineering problems:

1. Every provider has a different payload.
2. Every provider has a different signature/authentication mechanism.
3. Developers often need a publicly accessible callback URL for provider sandbox testing.
4. Webhooks can arrive more than once.
5. Webhooks can be delayed.
6. Webhooks can arrive in unexpected order.
7. Merchant endpoints can return `4xx` or `5xx`.
8. Signature verification is frequently implemented incorrectly.
9. Developers need reproducible test fixtures for CI.
10. Teams integrating multiple providers repeat almost the same testing work.

BayarLab turns those problems into deterministic scenarios.

Instead of:

```text
Provider dashboard
      ↓
Sandbox credentials
      ↓
Create transaction
      ↓
Expose localhost
      ↓
Simulate payment
      ↓
Wait for webhook
      ↓
Debug
      ↓
Repeat
```

BayarLab:

```text
Choose provider
      ↓
Choose scenario
      ↓
Send
      ↓
Inspect
      ↓
Replay / mutate / automate
```

---

# 3. Product Positioning

## 3.1 One-line positioning

> **Postman for Indonesian payment webhooks, with provider-aware payloads, signatures, lifecycle simulation, and failure testing.**

## 3.2 Better long-form positioning

> BayarLab is an open-source, local-first testing environment for Indonesian payment integrations. It generates provider-compatible webhook payloads and signatures, sends them to your local application, captures the response, and simulates production edge cases such as duplicate delivery, delay, invalid signatures, retries, and out-of-order events.

## 3.3 Why use the name “BayarLab”

`WebhookID` is descriptive but limits the future scope to webhooks.

`BayarLab` provides room for:

- webhook simulation;
- payment lifecycle simulation;
- sandbox bridges;
- request signing tools;
- provider fixtures;
- CI testing;
- payment integration diagnostics;
- contract testing;
- developer SDKs.

Recommended branding:

```text
BayarLab
Local payment integration laboratory for Indonesia.
```

---

# 4. Explicit Non-Goals

BayarLab must **not** become:

- a payment gateway;
- a payment router in the first releases;
- a merchant-of-record platform;
- a checkout UI;
- a wallet;
- a payment aggregator;
- a proxy for real production funds;
- a system for bypassing provider security;
- a storage system for real customer financial data.

This keeps the repository technically focused and reduces regulatory/security complexity.

---

# 5. Competitive Differentiation

There are already:

- provider-specific sandbox tools;
- official simulation endpoints for some provider products;
- local HTTP clients such as Postman;
- webhook inspection tools;
- Indonesian payment routing projects.

BayarLab should **not** compete by saying “we can also send HTTP POST”.

The differentiation must be:

```text
Generic HTTP Client
        vs
Provider-Aware Payment Test Engine
```

A generic HTTP client knows:

```json
{
  "status": "paid"
}
```

BayarLab knows:

```text
Provider
Payment product
Webhook schema
Required headers
Signature algorithm
Lifecycle state
Duplicate behavior
Retry behavior
Provider-specific identifiers
```

The highest-value features are therefore:

1. Provider-aware event generation.
2. Correct signing.
3. Payment lifecycle scenarios.
4. Reliability/chaos scenarios.
5. Replay.
6. CI-friendly deterministic mode.
7. Local-first operation.
8. No provider account required for mock mode.

---

# 6. Product Modes

BayarLab should have three progressively advanced modes.

## 6.1 Mode A — Local Mock Mode

**Priority: MVP**

No provider credentials required.

```text
BayarLab
   │
   ├── provider adapter
   ├── fixture generator
   ├── signer
   │
   ▼
localhost merchant app
```

Example:

```bash
bayarlab send midtrans settlement \
  --to http://localhost:3000/webhooks/midtrans
```

Use case:

- developing webhook endpoints;
- testing signature validation;
- unit/integration testing;
- frontend/backend development;
- CI pipelines.

---

## 6.2 Mode B — Chaos / Reliability Mode

**Priority: V0.2**

Simulate cases that often expose bad webhook implementations:

```text
duplicate delivery
delayed delivery
out-of-order delivery
invalid signature
missing signature
malformed payload
unexpected extra field
slow response
HTTP 500
HTTP 503
timeout
replay
```

Example:

```bash
bayarlab chaos midtrans settlement \
  --duplicate 2 \
  --delay 3000 \
  --to http://localhost:3000/webhook
```

This is one of BayarLab's strongest differentiators.

---

## 6.3 Mode C — Real Sandbox Bridge

**Priority: after stable local simulator**

BayarLab connects to a real provider sandbox.

```text
Provider Sandbox
       │
       ▼
BayarLab listener / relay
       │
       ├── inspect
       ├── store
       ├── replay
       └── compare
       │
       ▼
Developer application
```

Use cases:

- compare generated fixtures against real provider callbacks;
- record actual sandbox webhooks;
- replay them locally;
- validate adapter compatibility;
- debug provider-specific integrations.

This mode should be optional because it requires provider credentials and possibly a public endpoint.

---

# 7. User Personas

## Persona A — Backend Engineer

Problem:

> “I just want to know whether my `/webhook/midtrans` endpoint handles settlement, duplicates, and invalid signatures correctly.”

Needs:

- CLI;
- deterministic payload;
- signature support;
- response inspector;
- replay.

---

## Persona B — Full-stack / Indie Developer

Problem:

> “I do not want to repeatedly open provider dashboards just to test payment status changes.”

Needs:

- simple UI;
- one-command startup;
- common scenarios;
- copyable request/response.

---

## Persona C — QA / SDET

Problem:

> “We need reproducible payment scenarios in automated test environments.”

Needs:

- headless CLI;
- JSON output;
- exit codes;
- deterministic IDs;
- scenario files;
- CI integration.

---

## Persona D — Engineering Team

Problem:

> “We use multiple gateways and each team implements slightly different webhook testing logic.”

Needs:

- common abstraction;
- provider plugins;
- shared scenario definitions;
- contract tests;
- versioned fixtures.

---

# 8. Core User Journeys

## 8.1 First-run happy path

```bash
npx bayarlab
```

Expected flow:

```text
BayarLab

? Provider
❯ Midtrans
  Xendit
  DOKU

? Scenario
❯ Payment success / settlement
  Pending
  Expired
  Cancelled
  Failed

? Target webhook
http://localhost:3000/api/webhooks/midtrans

Sending...

✓ POST http://localhost:3000/api/webhooks/midtrans
✓ HTTP 200
✓ 92 ms

Press [r] to replay
Press [e] to edit
Press [i] to inspect
Press [q] to quit
```

---

## 8.2 Direct command

```bash
bayarlab send midtrans settlement \
  --to http://localhost:3000/api/webhooks/midtrans
```

---

## 8.3 Invalid signature test

```bash
bayarlab send midtrans settlement \
  --invalid-signature \
  --to http://localhost:3000/api/webhooks/midtrans
```

Expected application result:

```text
401 Unauthorized
```

BayarLab should indicate:

```text
Expected rejection: PASS
```

---

## 8.4 Duplicate event test

```bash
bayarlab send midtrans settlement \
  --repeat 2 \
  --same-event-id
```

Goal:

Verify idempotency.

---

## 8.5 CI scenario

```bash
bayarlab test ./bayarlab.scenario.yaml
```

Example scenario:

```yaml
provider: midtrans
target: http://localhost:3000/webhooks/midtrans

steps:
  - event: pending
    expect:
      status: 200

  - event: settlement
    expect:
      status: 200

  - event: settlement
    options:
      duplicate: true
    expect:
      status: 200
```

Exit:

```text
3 scenarios passed
0 failed

exit code 0
```

---

# 9. Normalized Payment Domain Model

Internally BayarLab should avoid coupling the engine to provider-specific status names.

Recommended normalized status model:

```ts
type PaymentState =
  | "PENDING"
  | "AUTHORIZED"
  | "PAID"
  | "FAILED"
  | "DENIED"
  | "CANCELLED"
  | "EXPIRED"
  | "REFUNDED"
  | "PARTIALLY_REFUNDED";
```

Then provider adapters map normalized state → provider-specific payload.

Example concept:

```text
BayarLab: PAID
     │
     ├── Midtrans → provider-specific settlement/capture representation
     ├── Xendit   → provider-specific paid/succeeded representation
     └── DOKU     → provider-specific SUCCESS representation
```

**Important:** exact mappings must be validated against current official documentation and product type. Never assume one provider has one universal webhook schema.

---

# 10. Provider Adapter Architecture

Use an adapter contract so providers are isolated.

Conceptual TypeScript interface:

```ts
export interface ProviderAdapter {
  manifest: ProviderManifest;

  listScenarios(): ScenarioDefinition[];

  buildEvent(input: BuildEventInput): Promise<ProviderEvent>;

  sign(
    event: ProviderEvent,
    config: SigningConfig
  ): Promise<SignedProviderEvent>;

  validateConfig(
    config: ProviderConfig
  ): Promise<ValidationResult>;

  normalize?(
    payload: unknown
  ): Promise<NormalizedPaymentEvent>;
}
```

Provider event:

```ts
export interface ProviderEvent {
  provider: string;
  scenario: string;
  method: "POST" | "GET";
  path?: string;
  headers: Record<string, string>;
  body: unknown;
  metadata: {
    eventId: string;
    transactionId?: string;
    createdAt: string;
  };
}
```

Provider directory:

```text
packages/providers/
├── midtrans/
│   ├── adapter.ts
│   ├── signer.ts
│   ├── scenarios/
│   ├── fixtures/
│   └── tests/
├── xendit/
└── doku/
```

---

# 11. Provider-Specific Initial Scope

## 11.1 Midtrans — Provider #1

Recommended first provider because:

- webhook concept is familiar to many Indonesian developers;
- signature logic is deterministic;
- official documentation clearly describes notification behavior;
- documentation explicitly discusses duplicate/idempotent handling and retry behavior.

Initial supported scenarios:

```text
pending
success / settlement
capture
deny
cancel
expire
refund
```

Initial support:

- provider-like payload generation;
- configurable order ID;
- configurable amount;
- deterministic transaction ID;
- signature generation;
- invalid signature mutation;
- duplicate webhook;
- response inspection.

Signature support must follow the official provider specification for the selected API/product.

For the common Midtrans notification flow, the documented signature formula is:

```text
SHA512(order_id + status_code + gross_amount + server_key)
```

Do not hardcode a real key. Default to a clearly synthetic local test key.

Example:

```bash
bayarlab config set midtrans.serverKey bayarlab-local-test-key
```

---

## 11.2 Xendit — Provider #2

Implement after the provider interface is proven with Midtrans.

Initial priorities:

- callback token/header generation where applicable;
- provider-specific payment events;
- unique event/payment identifiers;
- success/failure lifecycle fixtures;
- replay;
- duplicate delivery.

Important engineering rule:

Xendit has multiple payment products and webhook contracts. The adapter should be organized by product/API family when necessary rather than pretending all Xendit webhooks share one schema.

Concept:

```text
xendit/
├── payment-request/
├── payment-session/
└── common/
```

Do not expand product coverage before the adapter contract is stable.

---

## 11.3 DOKU — Provider #3

DOKU is technically valuable because it forces BayarLab's signing architecture to handle a different model.

DOKU documentation includes both SNAP and non-SNAP notification patterns.

Non-SNAP signing involves request metadata such as:

```text
Client-Id
Request-Id
Request-Timestamp
Request-Target
Digest
```

and HMAC-based signing.

SNAP products may use a different `X-SIGNATURE` contract.

Therefore structure DOKU as:

```text
doku/
├── non-snap/
├── snap/
└── common/
```

Do **not** merge SNAP/non-SNAP signing into one opaque function.

---

# 12. Delivery Engine

The delivery engine is provider-independent.

Responsibilities:

```text
Provider adapter
      ↓
Signed event
      ↓
Delivery engine
      ↓
HTTP target
      ↓
Response capture
      ↓
History / assertion
```

Core fields:

```ts
interface DeliveryResult {
  requestId: string;
  targetUrl: string;

  request: {
    method: string;
    headers: Record<string, string>;
    body: unknown;
  };

  response?: {
    status: number;
    headers: Record<string, string>;
    body?: string;
  };

  durationMs: number;

  error?: {
    code: string;
    message: string;
  };
}
```

Requirements:

- timeout support;
- redirect behavior explicitly controlled;
- request body size limits;
- sensitive headers masked in UI;
- localhost/private network supported;
- clear error output;
- machine-readable JSON output.

---

# 13. Scenario Engine

A scenario is more than one payload.

Example:

```yaml
name: successful-bank-transfer
provider: midtrans

variables:
  order_id: BL-DEMO-001
  amount: 150000

steps:
  - event: pending

  - wait: 1000

  - event: settlement
```

Later:

```yaml
name: duplicate-settlement

steps:
  - event: settlement

  - wait: 500

  - replay: previous
```

Chaos scenario:

```yaml
name: out-of-order-payment

steps:
  - event: settlement

  - wait: 300

  - event: pending
```

This lets QA teams store payment behavior as code.

---

# 14. Chaos Engine

This should become BayarLab's signature feature.

## Supported mutation categories

### Delivery mutation

```text
delay
duplicate
burst
timeout
disconnect
```

### Payload mutation

```text
missing field
extra field
wrong type
malformed JSON
modified amount
modified ID
```

### Authentication mutation

```text
missing signature
invalid signature
wrong secret
expired timestamp
modified signed body
```

### Sequence mutation

```text
duplicate success
success before pending
refund before success
late pending after success
```

CLI examples:

```bash
bayarlab chaos midtrans settlement --invalid-signature
```

```bash
bayarlab chaos midtrans settlement --duplicate 3
```

```bash
bayarlab chaos midtrans lifecycle --out-of-order
```

---

# 15. Local Dashboard

The dashboard should be useful but must not be a prerequisite for CLI use.

Start:

```bash
bayarlab ui
```

or default:

```bash
npx bayarlab
```

Potential local URL:

```text
http://127.0.0.1:8787
```

## Dashboard layout

```text
┌──────────────────────────────────────────────────────────┐
│ BayarLab                                      ● Local    │
├────────────┬─────────────────────────────────────────────┤
│ Providers  │ Scenario                                    │
│            │                                             │
│ Midtrans   │ Provider: Midtrans                          │
│ Xendit     │ Event: settlement                           │
│ DOKU       │ Amount: Rp150,000                           │
│            │ Order: BL-001                               │
│ History    │ Target: localhost:3000/webhook              │
│ Scenarios  │                                             │
│ Settings   │              [ SEND ]                       │
├────────────┼─────────────────────────────────────────────┤
│ History    │ POST /webhook   200   84ms                  │
│            │                                             │
│            │ Request | Response | Signature | Timeline   │
└────────────┴─────────────────────────────────────────────┘
```

## Required V0.1 dashboard features

- provider selection;
- scenario selection;
- target URL;
- editable variables;
- send;
- request inspector;
- response inspector;
- latency;
- replay;
- copy as cURL;
- history for current session.

Do not spend excessive time on visual polish during the MVP.

---

# 16. Storage Strategy

Avoid a database dependency in the earliest release.

## V0.1

Use an abstraction:

```ts
interface HistoryStore {
  append(record: HistoryRecord): Promise<void>;
  list(query?: HistoryQuery): Promise<HistoryRecord[]>;
  get(id: string): Promise<HistoryRecord | null>;
}
```

Default implementation:

```text
in-memory
+
optional JSONL:
~/.bayarlab/history.jsonl
```

Advantages:

- no native SQLite dependency;
- easier `npx` installation;
- portable;
- low setup friction.

## Later

Optional SQLite implementation if query/history requirements grow.

---

# 17. Recommended Tech Stack

## Runtime

```text
Node.js 20+ / current supported LTS
TypeScript
```

Reason:

- strong fit with the intended contributor pool;
- excellent npm/npx distribution;
- simple HTTP tooling;
- strong schema validation ecosystem;
- easy frontend sharing of types.

## Monorepo

```text
pnpm workspace
```

## CLI

Recommended:

```text
commander
+
@inquirer/prompts
```

Alternative:

```text
oclif
```

Start with Commander unless command complexity grows substantially.

## HTTP service

```text
Fastify
```

Reasons:

- lightweight;
- good TypeScript support;
- schema-friendly;
- easy local API.

## Validation

```text
Zod
```

## Testing

```text
Vitest
```

plus:

```text
undici / native fetch
```

for HTTP.

## UI

```text
React
Vite
TypeScript
```

UI can be bundled into the npm package and served locally by Fastify.

## Formatting/linting

Choose one coherent setup:

```text
Biome
```

or ESLint + Prettier.

Recommended for a new repository:

```text
Biome
```

to reduce configuration overhead.

---

# 18. Proposed Repository Structure

```text
bayarlab/
├── apps/
│   ├── cli/
│   │   └── src/
│   └── web/
│       └── src/
│
├── packages/
│   ├── core/
│   │   ├── domain/
│   │   ├── scenarios/
│   │   └── errors/
│   │
│   ├── engine/
│   │   ├── delivery/
│   │   ├── chaos/
│   │   └── runner/
│   │
│   ├── provider-contract/
│   │   └── src/
│   │
│   ├── providers/
│   │   ├── midtrans/
│   │   ├── xendit/
│   │   └── doku/
│   │
│   ├── storage/
│   ├── testkit/
│   └── shared/
│
├── examples/
│   ├── express/
│   ├── nextjs/
│   ├── laravel/
│   └── scenario-files/
│
├── docs/
│   ├── architecture.md
│   ├── provider-development.md
│   ├── security.md
│   ├── contributing.md
│   └── providers/
│
├── scripts/
├── .github/
│   ├── workflows/
│   ├── ISSUE_TEMPLATE/
│   └── PULL_REQUEST_TEMPLATE.md
│
├── README.md
├── LICENSE
├── SECURITY.md
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
├── package.json
└── pnpm-workspace.yaml
```

---

# 19. CLI Design

## Core commands

```bash
bayarlab
```

Interactive launcher.

```bash
bayarlab send
```

Send one event.

```bash
bayarlab scenario
```

Run a lifecycle scenario.

```bash
bayarlab chaos
```

Run reliability mutations.

```bash
bayarlab history
```

View/replay local requests.

```bash
bayarlab providers
```

List installed providers and capabilities.

```bash
bayarlab inspect
```

Inspect a fixture/signature without sending.

```bash
bayarlab doctor
```

Diagnose environment/configuration.

```bash
bayarlab ui
```

Start local dashboard.

## Example

```bash
bayarlab send midtrans settlement \
  --to http://localhost:3000/webhook \
  --amount 150000 \
  --order-id DEMO-001
```

JSON mode:

```bash
bayarlab send midtrans settlement \
  --to http://localhost:3000/webhook \
  --output json
```

CI must receive stable exit codes.

---

# 20. Configuration

Local config:

```text
~/.bayarlab/config.json
```

Project config:

```text
bayarlab.config.ts
```

Example:

```ts
export default {
  target: "http://localhost:3000",
  providers: {
    midtrans: {
      webhookPath: "/api/webhooks/midtrans",
      serverKey: {
        env: "BAYARLAB_MIDTRANS_TEST_KEY",
      },
    },
  },
};
```

Priority:

```text
CLI arguments
    ↓
environment variables
    ↓
project config
    ↓
user config
    ↓
defaults
```

Never write secrets into generated examples.

---

# 21. Security Requirements

Although BayarLab is a developer tool, payment integrations are security-sensitive.

## Mandatory rules

1. Never collect real provider credentials by default.
2. No telemetry by default.
3. Never transmit configuration to BayarLab infrastructure.
4. Mask credentials in logs.
5. Mask authorization/signature headers in screenshots.
6. Synthetic fixture data only.
7. Explicit warning before targeting non-local URLs.
8. Refuse accidental production-looking execution unless explicitly overridden.
9. Separate mock credentials from real sandbox credentials.
10. Add `SECURITY.md`.

Example safety guard:

```text
Target: https://api.mycompany.com/webhook

⚠ Target is not localhost/private development address.

Continue? [y/N]
```

Headless mode:

```bash
--allow-remote-target
```

should be explicit.

---

# 22. Provider Fidelity Policy

BayarLab should state clearly:

> “Compatible simulation, not an official provider implementation.”

Every adapter must document:

```text
Provider documentation version/date checked
Supported API/product family
Supported events
Signing behavior
Known differences
Unsupported fields
```

Add metadata:

```ts
export const manifest = {
  provider: "midtrans",
  adapterVersion: "0.1.0",
  docsVerifiedAt: "2026-09-15",
  products: ["..."],
};
```

Provider docs can change. Fidelity must be continuously tested.

---

# 23. Testing Strategy

## 23.1 Unit tests

Test:

- fixture generation;
- deterministic IDs;
- signer output;
- mutation engine;
- normalized state mapping;
- config parsing.

---

## 23.2 Golden fixture tests

Store expected payload snapshots.

```text
fixtures/
├── settlement.json
├── pending.json
└── expired.json
```

When output changes, contributors must intentionally approve fixture updates.

---

## 23.3 Signature vectors

For every signing algorithm, create known input/output test vectors.

Example structure:

```ts
{
  input: {...},
  secret: "synthetic-test-key",
  expectedSignature: "..."
}
```

This is especially important for:

- Midtrans;
- DOKU;
- future providers using canonicalized payloads.

---

## 23.4 HTTP integration tests

Spin up a local test server.

Test:

```text
200
201
400
401
404
429
500
503
timeout
redirect
```

---

## 23.5 Provider contract tests

All adapters must pass a shared suite:

```text
✓ has metadata
✓ lists scenarios
✓ produces valid event
✓ deterministic mode works
✓ secrets are not included in logs
✓ signing returns expected representation
✓ invalid-signature mutation works
```

---

## 23.6 E2E

Example Express/Next.js application receives generated webhook.

Pipeline:

```text
build
↓
start sample app
↓
run BayarLab
↓
assert merchant state
```

---

# 24. CI/CD

GitHub Actions:

```text
lint
typecheck
unit test
integration test
build
package smoke test
```

On pull request:

```text
Node supported versions matrix
Linux
macOS
Windows
```

Before release:

```text
npm pack
install tarball in clean temp directory
npx smoke test
```

This matters because local developer tools often fail from packaging mistakes rather than application logic.

---

# 25. Release Strategy

## V0.1.0 — Midtrans MVP

Definition of done:

```text
✓ npx bayarlab works
✓ Midtrans adapter
✓ >= 5 scenarios
✓ signature generation
✓ invalid signature
✓ target URL
✓ request/response inspector
✓ replay
✓ CLI
✓ basic dashboard
✓ tests
✓ documentation
```

Do not add Xendit before this is pleasant to use.

---

## V0.2.0 — Reliability Lab

```text
✓ duplicate delivery
✓ delay
✓ out-of-order
✓ malformed payload
✓ missing signature
✓ scenario YAML
✓ CI command
```

This release establishes BayarLab's unique value.

---

## V0.3.0 — Xendit

```text
✓ first selected Xendit product family
✓ callback authentication
✓ provider fixtures
✓ lifecycle scenarios
✓ docs
```

---

## V0.4.0 — DOKU

```text
✓ selected non-SNAP product family
✓ signing support
✓ fixtures
✓ scenarios
✓ first SNAP support if architecture is ready
```

---

## V0.5.0 — Sandbox Bridge

```text
✓ record real sandbox webhook
✓ compare generated vs captured payload
✓ replay captured callback
✓ scrub sensitive values
```

---

## V1.0.0

V1 should mean:

```text
stable provider adapter API
stable scenario file schema
stable CLI commands
Midtrans + Xendit + DOKU support
CI mode
chaos scenarios
replay/history
documented extension SDK
```

---

# 26. Development Phases

## Phase 0 — Product Validation & Provider Research

**Estimated:** 1–2 days

### Tasks

- finalize BayarLab positioning;
- inspect current official Midtrans webhook docs;
- inspect current Xendit webhook docs;
- inspect current DOKU notification docs;
- select exact API/product families for V0.x;
- write provider capability matrix;
- identify competitor overlap;
- lock V0.1 scope.

### Deliverables

```text
docs/product-spec.md
docs/provider-matrix.md
docs/competitive-notes.md
```

### Exit criteria

You can answer:

> “Exactly what does BayarLab simulate in V0.1, and what does it deliberately not simulate?”

### Recommended AI model

**Primary: Astra — low/medium effort**

Use Astra for:

- ambiguity reduction;
- architecture/product trade-offs;
- reading multiple provider contracts;
- identifying hidden edge cases.

**Alternative: Sol — high**

Do not use Astra for routine file creation.

---

# Phase 1 — Repository Foundation

**Estimated:** 1 day

### Tasks

- initialize repository;
- pnpm workspace;
- TypeScript strict mode;
- package boundaries;
- Biome;
- Vitest;
- changeset/release setup;
- GitHub Actions;
- basic CLI binary;
- provider contract.

### Deliverables

```text
npx bayarlab --help
```

working locally.

### AI model

**Primary: Terra — medium**

Why:

- bounded scaffolding;
- configuration;
- boilerplate.

**Review: Sol — medium**

Check architecture boundaries once.

---

# Phase 2 — Core Domain & Delivery Engine

**Estimated:** 2–3 days

### Tasks

- normalized payment domain;
- event type;
- scenario type;
- provider adapter interface;
- HTTP delivery engine;
- response capture;
- timeouts;
- output formatter;
- errors.

### Deliverables

Fake/demo provider can send a signed synthetic event to localhost.

### Tests

Minimum:

```text
unit tests
local HTTP integration tests
error handling tests
```

### AI model

**Primary: Sol — high**

Use for:

- core abstractions;
- difficult TypeScript types;
- error model;
- clean API boundaries.

**Support: Luna**

Use for:

- repetitive tests;
- fixture generation;
- lint/type fixes.

---

# Phase 3 — Midtrans Adapter

**Estimated:** 2–4 days

### Tasks

- select webhook/product scope;
- event fixtures;
- scenario builder;
- signature generation;
- known signature vectors;
- success/pending/expire/cancel/failure scenarios;
- invalid-signature mutation;
- documentation.

### Deliverables

```bash
bayarlab send midtrans settlement \
  --to http://localhost:3000/webhook
```

### Quality bar

The adapter must be traceable to official documentation.

### AI model

**Primary: Sol — high**

**Critical review: Astra — medium**

Use Astra once after implementation to check:

- signature logic;
- assumptions;
- product/schema confusion;
- missing security cases.

**Luna**

Generate extra test cases after the reference tests are correct.

---

# Phase 4 — CLI MVP

**Estimated:** 1–2 days

### Tasks

- interactive provider selection;
- interactive scenario selection;
- target URL;
- variables;
- pretty output;
- JSON output;
- replay;
- inspect;
- config loading.

### Deliverables

A developer can use BayarLab without reading documentation.

### AI model

**Primary: Terra — medium**

**Luna**

Good for:

- help copy;
- command aliases;
- repetitive argument wiring;
- terminal formatting tests.

---

# Phase 5 — Dashboard MVP

**Estimated:** 2–3 days

### Tasks

- Fastify local API;
- React/Vite dashboard;
- provider list;
- scenario selector;
- payload editor/preview;
- send;
- request/response tabs;
- timeline;
- replay.

### Deliverables

Demo-ready local interface.

### AI model

**Primary: Terra — medium/high**

Why:

- component implementation;
- frontend state;
- API binding.

**Sol — medium**

Use for:

- frontend architecture review;
- state-flow bugs.

**Luna**

Use for:

- UI cleanup;
- minor components;
- accessibility fixes;
- repetitive styling.

---

# Phase 6 — Chaos & Reliability Engine

Implementation update (2026-09-23): reusable post-signing mutations, bounded sequential runner,
response assertions, and `bayarlab chaos` are implemented. Semantics, limits, and examples:
[docs/chaos.md](docs/chaos.md). YAML remains Phase 7; automatic provider retry schedules are not simulated.

**Estimated:** 2–4 days

### Tasks

- duplicate;
- delay;
- invalid signature;
- missing signature;
- payload mutation;
- out-of-order sequence;
- malformed body;
- response assertions;
- scenario runner.

### Deliverables

```bash
bayarlab chaos midtrans settlement --duplicate 3
```

### This phase is strategically important

This is the point where BayarLab becomes substantially more useful than “a collection of webhook JSON files”.

### AI model

**Primary: Sol — high**

**Design/review: Astra — medium**

Use Astra for adversarial/reliability reasoning:

> “What realistic failure modes can break a payment webhook implementation?”

**Luna**

Use to expand the test matrix.

---

# Phase 7 — CI Scenario Format

Implementation update (2026-09-23): YAML schema with Zod validation, deterministic clock/ID generation (`deriveId`, `deriveTimestamp`), assertions (status, body substring, max duration, transport error), exit codes (0/1/2), machine-readable reporting (`text`, `json`, `junit`), `bayarlab test <file|dir>` CLI command, and GitHub Actions CI workflow example are implemented and verified. Semantics and reference: [docs/ci-scenarios.md](docs/ci-scenarios.md).

**Estimated:** 1–2 days

### Tasks

- YAML schema;
- deterministic clock/IDs;
- assertions;
- exit codes;
- machine-readable report;
- GitHub Actions example.

### Deliverables

```bash
bayarlab test bayarlab.scenario.yaml
```

### AI model

**Primary: Terra — medium**

**Sol review**

Check deterministic behavior and scenario schema longevity.

---

# Phase 8 — Xendit Adapter

Implementation update (2026-09-23): Payments API v3 ID/DANA `PAY` automatic-capture adapter, callback-token authentication, capture fixture and explicitly composed failure fixture, CLI/chaos/YAML integration, local receiver contract tests, and provider documentation are implemented. Channel-specific DANA failure fidelity remains unverified without a sandbox callback. See [docs/providers/xendit.md](docs/providers/xendit.md).

**Estimated:** 3–5 days

### Tasks

- choose one initial Xendit API/product family;
- event authentication;
- fixtures;
- lifecycle scenarios;
- test vectors;
- provider docs;
- contract tests.

### Important

Do not model “Xendit” as one homogeneous webhook contract if products differ.

### AI model

**Primary: Sol — high**

**Astra — medium for provider-contract audit**

**Luna — repetitive test coverage**

---

# Phase 9 — DOKU Adapter

Implementation update (2026-09-28): Direct API non-SNAP Mandiri VA success adapter, byte-exact SHA-256 digest and HMAC-SHA256 signer, Request-Id/Timestamp/Target generation, query-target guard, golden fixture, independent OpenSSL vectors, CLI/dashboard/chaos/YAML integration, local receiver contract tests, and SNAP separation are implemented. No real DOKU sandbox callback was captured. See [docs/providers/doku.md](docs/providers/doku.md).

**Estimated:** 3–5 days

### Tasks

- begin with one documented product family;
- implement non-SNAP signing separately;
- signature digest tests;
- Request-Id/Timestamp/Target generation;
- SNAP architecture preparation;
- fixtures;
- chaos scenarios.

### AI model

**Primary: Sol — high**

**Astra — high for signing/security review**

DOKU's multiple signing styles make this a poor phase for low-capability autonomous coding without review.

**Luna**

Use only after core logic has reference tests.

---

# Phase 10 — Open-Source Hardening

**Estimated:** 2–3 days

### Tasks

- README;
- GIF/demo recording plan;
- architecture diagram;
- CONTRIBUTING;
- CODE_OF_CONDUCT;
- SECURITY;
- issue templates;
- feature request template;
- provider adapter guide;
- first-good-issue labels;
- package smoke test;
- cross-platform tests.

### AI model

**Primary: Terra — medium**

**Luna**

Excellent for:

- docs cleanup;
- templates;
- typo fixes;
- examples.

**Sol**

Final technical documentation verification.

---

# Phase 11 — Release Candidate Audit

**Estimated:** 1–2 days

### Tasks

Review the repository as if you are:

```text
security engineer
backend engineer
QA engineer
open-source contributor
first-time user
```

Audit:

- secret leakage;
- incorrect signing;
- unsafe remote target behavior;
- provider fidelity;
- CLI UX;
- install process;
- packaging;
- documentation accuracy.

### AI model

**Primary: Astra — high**

This is a good place to spend the strongest model.

Ask Astra to perform an architecture/security/release audit without making unnecessary redesigns.

**Sol — high**

Implement the approved fixes.

---

# Phase 12 — Public Launch

> **Phase 12 preparation — 2026-10-03:** README launch links, the architecture
> SVG, isolated Express and Next.js receiver examples, 0.1.0 draft release notes,
> and Indonesian X/Threads and developer-community announcement drafts are
> prepared. The maintainer designated
> [github.com/idwip11/bayarlab](https://github.com/idwip11/bayarlab); the local
> `origin` points there and the repository is public. The initial source push
> succeeded. No package or announcement has been published. The 20–40 second
> demo still needs an actual local capture and frame review. The DOKU scenario
> workflow passed on Node 22/24. The first 3×3 CI attempt found an overlong
> Express log line, now fixed. The next matrix passed lint/build/tests on Linux
> and macOS but exposed Windows CRLF checkout behavior in Biome. `.gitattributes`
> now enforces LF for text files; the matrix rerun is pending.
> npm package ownership is unconfirmed. See [launch notes](docs/launch-announcement-id.md),
> [release draft](docs/releases/v0.1.0.md), and [Phase 11 audit](docs/release-candidate-audit.md).

**Estimated:** 1 day + ongoing

### Launch assets

- GitHub README;
- 20–40 second demo GIF/video;
- simple architecture diagram;
- example Express/Next.js webhook receiver;
- release notes;
- Threads/X post;
- Indonesian developer communities;
- relevant Discord/Telegram communities;
- Reddit where appropriate.

### AI model

**Primary: Luna / Terra**

Use for:

- release copy variants;
- changelog formatting;
- issue triage;
- translations.

Do not spend Astra credits writing social-media captions.

---

# 27. AI Model Usage Strategy

Current model roles can be simplified to:

| Model | Best use in BayarLab workflow |
|---|---|
| **Astra** | Highest-ambiguity architecture, security review, complex provider-contract comparison, release audit |
| **Sol** | Core engineering, difficult refactors, signing logic, scenario engine, provider implementation |
| **Terra** | Balanced implementation, CLI/UI work, docs, bounded features |
| **Luna** | Fast repetitive work, tests, fixtures, lint fixes, boilerplate, documentation cleanup |

Recommended rule:

```text
Astra decides the difficult things.
Sol builds the difficult things.
Terra builds the normal things.
Luna clears the repetitive queue.
```

Do not use the strongest model for every task.

---

# 28. Suggested Multi-Agent Workflow

For difficult phases:

```text
Astra
  ↓
writes implementation constraints / review checklist
  ↓
Sol
  ↓
implements
  ↓
Luna
  ↓
expands tests and performs routine cleanup
  ↓
Sol
  ↓
reviews failing tests / integrates
```

For normal phases:

```text
Terra
  ↓
implementation
  ↓
Luna
  ↓
tests + cleanup
```

For release:

```text
Astra
  ↓
audit
  ↓
Sol
  ↓
fixes
  ↓
Terra/Luna
  ↓
docs + release artifacts
```

Avoid multi-agent overhead on tiny tasks.

---

# 29. Definition of Done Per Feature

A feature is not done because “the code runs”.

Every meaningful feature should satisfy:

```text
[ ] implementation
[ ] unit tests
[ ] integration tests where applicable
[ ] error handling
[ ] CLI output
[ ] docs
[ ] no secret leakage
[ ] provider reference validated
[ ] Windows/macOS/Linux implications considered
```

Provider feature:

```text
[ ] official docs reviewed
[ ] schema supported documented
[ ] unsupported behavior documented
[ ] fixture snapshot
[ ] signature vector
[ ] valid signature case
[ ] invalid signature case
[ ] duplicate case
```

---

# 30. MVP Scope Lock

To prevent feature creep, **V0.1 should only contain**:

```text
Midtrans adapter
5–7 payment scenarios
signature generation
invalid signature
duplicate event
CLI
basic local dashboard
response inspector
replay
in-memory/session history
tests
README
```

Do **not** include in V0.1:

```text
Xendit
DOKU
cloud accounts
team collaboration
authentication
hosted dashboard
real-money flows
plugin marketplace
complex database
remote synchronization
```

---

# 31. V0.1 Acceptance Test

A fresh developer should be able to run:

```bash
npx bayarlab
```

choose:

```text
Midtrans
Settlement
http://localhost:3000/webhook
```

and receive:

```text
✓ webhook sent
✓ HTTP 200
✓ signature attached
✓ request visible
✓ response visible
```

Then:

```text
Replay
```

and verify their application does not double-process the transaction.

Then:

```text
Invalid Signature
```

and verify their application rejects it.

If those three workflows feel excellent, the MVP is successful.

---

# 32. Suggested GitHub README Hero

```markdown
# BayarLab 🇮🇩

Local-first payment webhook simulator for Indonesian developers.

Test Midtrans, Xendit, and DOKU integrations without repeatedly creating
sandbox transactions.

- Provider-compatible payloads
- Signature generation
- Duplicate webhook testing
- Delays and out-of-order events
- Request/response inspector
- Replay
- CI scenarios

```bash
npx bayarlab
```

No account required for local mock mode.
```

---

# 33. README Language Strategy

Primary README:

```text
English
```

Reason:

- easier international discovery;
- Indonesian engineers are generally comfortable with technical English;
- future providers/community contributors may be outside Indonesia.

Secondary:

```text
README.id.md
```

This gives BayarLab an explicitly Indonesian identity without limiting discoverability.

---

# 34. GitHub Growth Mechanics

Design for “starability”.

The first 20 seconds should show value.

README order:

```text
1. One-sentence value proposition
2. GIF
3. npx command
4. Why
5. Supported providers
6. Examples
7. Chaos testing
8. CI
9. Contributing
```

Avoid starting with long architecture explanations.

Good visual demo:

```text
terminal
↓
select Midtrans settlement
↓
webhook request appears
↓
HTTP 200
↓
click duplicate
↓
app remains idempotent
```

That communicates the product immediately.

---

# 35. Contribution Strategy

Provider support is ideal for community contributions.

Document:

```text
How to build an adapter
How to add fixtures
How to add signing tests
How to document source references
```

Possible future contributor command:

```bash
bayarlab provider:create
```

generates:

```text
adapter.ts
manifest.ts
fixtures/
tests/
README.md
```

Do not implement this generator before V1 unless contributors actually need it.

---

# 36. Future Roadmap Ideas

After V1:

## Provider expansion

Potential:

```text
iPaymu
Nicepay
Faspay
Tripay
Digiflazz-style webhook ecosystems
```

Prioritize based on community demand, not completeness.

## SDK

```ts
import { createBayarLab } from "@bayarlab/core";
```

Useful for custom test suites.

## VS Code integration

Run/replay webhook from editor.

## Docker image

Useful for CI and polyglot teams.

## Contract drift detector

Compare latest real sandbox callback against stored fixture schema.

## “Record and replay”

Capture a sandbox webhook:

```bash
bayarlab record
```

Then:

```bash
bayarlab replay event_123
```

## Framework examples

```text
Laravel
Express
NestJS
Next.js
FastAPI
Go
Spring Boot
```

---

# 37. Metrics That Matter

Do not judge success only by GitHub stars.

Track:

```text
npm downloads
GitHub stars
forks
contributors
issues opened
providers requested
README → install conversion
time-to-first-event
repeat users
```

Most important product metric:

> **Can a developer reproduce a payment webhook problem faster with BayarLab than with the provider sandbox?**

---

# 38. Risks

## Risk 1 — Provider documentation changes

Mitigation:

- `docsVerifiedAt`;
- contract tests;
- community issue template;
- adapter versioning.

## Risk 2 — Incorrect simulation creates false confidence

Mitigation:

- explicitly state supported scope;
- golden fixtures;
- real sandbox validation;
- no claim of official certification.

## Risk 3 — Too much UI work

Mitigation:

- CLI-first architecture;
- minimal dashboard;
- no cloud backend.

## Risk 4 — Scope explosion across provider products

Mitigation:

- provider + product adapters;
- support one product family at a time;
- documented unsupported coverage.

## Risk 5 — Credential leakage

Mitigation:

- local-first;
- synthetic keys;
- log masking;
- no telemetry;
- `SECURITY.md`.

---

# 39. Implementation Sequence Summary

```text
PHASE 0
Research + scope
    ↓
PHASE 1
Repo foundation
    ↓
PHASE 2
Core + delivery
    ↓
PHASE 3
Midtrans
    ↓
PHASE 4
CLI
    ↓
PHASE 5
Dashboard
    ↓
PHASE 6
Chaos engine
    ↓
PHASE 7
CI scenarios
    ↓
RELEASE V0.2
    ↓
PHASE 8
Xendit
    ↓
PHASE 9
DOKU
    ↓
PHASE 10
OSS hardening
    ↓
PHASE 11
Astra/Sol audit
    ↓
PHASE 12
Public launch
```

---

# 40. Recommended Solo Timeline

For one developer using AI coding agents heavily:

| Week | Target |
|---|---|
| **Week 1** | Research, architecture, repo, core, delivery engine |
| **Week 2** | Midtrans adapter + CLI |
| **Week 3** | Dashboard + replay/history |
| **Week 4** | Chaos engine + CI scenarios |
| **Week 5** | Xendit |
| **Week 6** | DOKU |
| **Week 7** | Documentation, examples, security, QA |
| **Week 8** | RC audit, polish, public release |

A more aggressive MVP can be released after Week 3–4.

Do not wait for three providers before sharing the project publicly.

A high-quality Midtrans-only release is better than three incomplete adapters.

---

# 41. First Engineering Ticket

Start with this ticket:

```text
BL-001 — Bootstrap BayarLab monorepo and provider contract

Acceptance criteria:
- pnpm workspace
- TypeScript strict
- apps/cli
- packages/core
- packages/provider-contract
- packages/providers/midtrans placeholder
- Vitest
- Biome
- GitHub Actions
- `pnpm test`
- `pnpm typecheck`
- `pnpm lint`
- local `bayarlab --help`
```

Recommended model:

```text
Terra medium
```

Then run a one-time architecture review with:

```text
Sol high
```

Do not start by asking an agent:

> “Build the entire BayarLab project.”

Build phase-by-phase with acceptance criteria.

---

# 42. First Provider Ticket

```text
BL-010 — Implement first Midtrans notification scenario

Scope:
- settlement scenario only
- synthetic order ID
- synthetic amount
- synthetic server key
- documented signature calculation
- POST to localhost
- response capture

Acceptance:
- fixture snapshot passes
- known signature vector passes
- Express test receiver gets payload
- valid signature accepted
- corrupted signature rejected
```

Recommended model:

```text
Sol high
```

Review:

```text
Astra medium
```

---

# 43. Source References for Initial Provider Research

Official/reference material consulted for this implementation plan:

- Midtrans HTTP Notifications / Webhooks:  
  https://docs.midtrans.com/docs/https-notification-webhooks

- Midtrans notification authenticity / signature reference:  
  https://docs.midtrans.com/reference/handle-notifications

- Midtrans sandbox payment testing:  
  https://docs.midtrans.com/docs/testing-payment-on-sandbox

- Xendit webhook handling guidance:  
  https://docs.xendit.co/docs/handling-webhooks

- DOKU HTTP notification samples — non-SNAP:  
  https://developers.doku.com/get-started-with-doku-api/notification/http-notification-sample-non-snap

- DOKU HTTP notification samples — SNAP:  
  https://developers.doku.com/get-started-with-doku-api/notification/http-notification-sample-for-snap

- DOKU notification best practices:  
  https://developers.doku.com/get-started-with-doku-api/notification/best-practice

- DOKU notification URL setup:  
  https://developers.doku.com/get-started-with-doku-api/notification/setup-notification-url

- Existing Indonesian payment-router project used only for competitive differentiation research:  
  https://github.com/pendig/rute-bayar

---

# 44. Final Product Principle

Every product decision should optimize this moment:

```text
Developer has a payment webhook bug.
↓
Developer runs BayarLab.
↓
Developer reproduces it in less than one minute.
↓
Developer understands exactly what went wrong.
```

If BayarLab consistently does that, the repository has real engineering value and a credible reason to be starred, shared, and contributed to.
