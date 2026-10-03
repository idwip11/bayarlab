# Phase 11 — Release Candidate Audit

Audit and remediation date: **2026-10-03 (Asia/Makassar)**. **RC-001–RC-013 are resolved and locally verified.** Public release approval remains **pending** until an identifiable candidate commit passes the cross-platform CI gates below. No package has been published.

The initial review used the security engineer, backend engineer, QA, contributor, and first-time user perspectives specified in the implementation plan. Its original decision was **NO-GO**. The original evidence/findings are retained below as the baseline; the remediation ledger records the subsequent fixes. At initial audit time, the checkout had no `HEAD`; the maintainer has since designated `https://github.com/idwip11/bayarlab` and configured it as `origin`. Candidate source is committed locally; its push and cross-platform CI run are pending. Use the pushed `main` commit and its workflow results as the release candidate evidence.

## Remediation ledger

The maintainer selected **MIT**, copyright **BayarLab contributors**. The public executable package follows the blueprint's name, **`bayarlab`**, with candidate version **0.1.0**. Internal workspace packages remain private; no registry publication or remote repository changes were performed.

| ID | Current status | Fix and regression evidence |
| --- | --- | --- |
| RC-001 | Resolved locally | Redact parsed JSON strings/keys before serialization; apply reflected authentication values to request/response headers, bodies, URLs, and errors. Engine formatter tests cover nested escaped strings, arrays, malformed-body plaintext reflections, encoded URLs, fail-closed omission at extreme JSON depth, and unchanged wire bytes. |
| RC-002 | Resolved locally | Configuration and interactive defaults use shared `redactTargetUrl`; original target remains internal. CLI config and URL tests cover sensitive/encoded query values. |
| RC-003 | Resolved locally | Root public package bundles the internal runtime and dashboard assets, with external runtime dependencies and an allowlist. Isolated `npm pack` → `npm install` → installed CLI/npm exec/dashboard smoke passes with no workspace links. |
| RC-004 | Resolved locally | MIT `LICENSE` and all package license metadata added; installed archive includes the selected copyright/license and license copies for the bundled React, React DOM, and Scheduler client libraries. |
| RC-005 | Resolved locally | Vite 7.3.6, Vitest 4.1.11, brace-expansion 5.0.12 override; regenerated lockfile. Full, workspace-runtime, and installed-artifact runtime audits report zero advisories. |
| RC-006 | Resolved locally | Normalize only supported payment-type/status combinations; selected card outcomes require accepted fraud status. Challenge, deny, absent/unknown fraud outcomes on capture, and incompatible payment types are rejected. Golden accepted fixtures still pass. |
| RC-007 | Resolved locally | Shared order retains transaction identity, with optional explicit `variables.transaction_id`. Seeded/unseeded lifecycle tests verify matching transaction IDs and exact duplicate wire bytes; independent steps retain distinct transactions. Example/docs updated. |
| RC-008 | Resolved locally | Single aggregate JUnit root/declaration and single JSON document for directory runs; single-file JSON stays compatible. XML was parsed with Python ElementTree: two suites/two tests; aggregate JSON parsed successfully. |
| RC-009 | Resolved locally | Event/wait schemas are strict; misspelled fields and ambiguous event+wait steps are rejected. Schema/CLI regressions verify `steps.0` validation errors and exit 2. |
| RC-010 | Resolved locally | Async central Commander error handling covers direct and separately added test/chaos commands; invalid input exits 2 without a stack. Non-TTY no-argument/help/version exits 0. Entire per-file event preparation is preflighted before delivery; assertions still exit 1. |
| RC-011 | Resolved locally | Source/artifact requirement is Node >=22.13.0, aligned with pnpm 11.19.0 and the build tools. An attempted 22.12.0 run exposed pnpm's >=22.13 requirement. Clean frozen install, build, tests, typecheck and installed-artifact smoke pass on exact 22.13.0. CI adds that exact minimum. |
| RC-012 | Resolved locally | History retains explicit same-target remote consent; replay re-resolves every attempt and returns typed HTTP 400 policy errors. DNS-stub tests keep all traffic on loopback and verify acknowledged success, unsafe-address denial, and unacknowledged remote denial without sending. |
| RC-013 | Resolved locally | Interactive override is false for local sends and true only after affirmative remote confirmation. A process-only DNS stub proves a locally named target resolving to a public address is denied. |

## Post-remediation verification

| Check | Current result | Limits |
| --- | --- | --- |
| Lint and TypeScript | Passed | Biome and full TS graph/client checks |
| Full build and regression suite | **130 tests passed in 17 test files** | macOS; host Node 26.7.0 and clean source on Node 22.13.0 |
| Clean source install at minimum Node | Passed | Exact Node 22.13.0, pnpm 11.19.0, frozen lockfile, 160 dependencies reused offline |
| Workspace CLI smoke | Passed | All registered adapters and redacted inspections |
| Installed release smoke | Passed | Independent temporary consumer; ten allowlisted archive files including third-party licenses; help/no-argument/version, locally installed executable via npm exec/npx with registry fallback disabled, all three provider inspections, input-error exits, dashboard HTML/JS/CSS |
| License in repository/installed artifact | Passed | MIT, copyright 2026 BayarLab contributors |
| Full and production dependency audits | **Zero reported advisories** | Includes development graph and independently resolved installed runtime graph; registry snapshot, not a permanent guarantee |
| Multi-file machine-readable reports | Passed | ElementTree XML parse and JSON parse, aggregate counts; report/unit/CLI regressions |
| Cross-platform CI | Configured, **not yet observed** | Ubuntu/macOS/Windows × Node 22.13.0/22/24; pnpm pinned to 11.19.0; installed release smoke added |
| Identifiable candidate commit | **Created locally; push/CI pending** | Candidate source is committed locally; verify CI against the pushed `main` commit. |
| Public repository identity | **Designated; push pending** | Maintainer designated `https://github.com/idwip11/bayarlab`; its visibility/access and initial source push have not been verified from this environment. |
| npm package name ownership | **Unconfirmed** | `npm view bayarlab` returned E404; private/inaccessible package names also produce that response. This is not proof that the name can be published by this maintainer. |

One simultaneous host/minimum-version test run hit the old 5-second CLI subprocess harness timeout under CPU load. CLI test timeout is now bounded at 30 seconds to include process startup on CI; HTTP timeouts and response-duration assertions are unchanged. Final reruns passed. Smoke tests remove only their uniquely created temporary consumers. No real payment traffic or credentials were used.

Reproduce from the repository with `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm smoke:packages`, `pnpm smoke:release`, `pnpm audit --json`, and `pnpm audit --prod --json`. The release smoke requires registry access and localhost binding. It also audits the installed runtime graph.

## Original audit verification evidence (before fixes)

| Check | Result | Limits |
| --- | --- | --- |
| Formatting/lint | Passed, 89 files | Local Biome executable |
| TypeScript graph and dashboard client | Passed | Local compiler |
| `pnpm test` including full build | **90 tests passed in 14 test files** | macOS, Node 26.7.0, pnpm 11.19.0; localhost permission granted |
| Workspace package smoke | Passed | Runs the built CLI inside the workspace, not an installed release artifact |
| Clean source install, build, and smoke | Passed | Isolated temporary copy; frozen lockfile; 158 dependencies reused from the local store with `--offline` |
| Actual CLI tarball install in isolated consumer | **Failed** | `npm pack` succeeds; installation fails with `EUNSUPPORTEDPROTOCOL: workspace:*` |
| Runtime dependency advisory check | Passed | `pnpm audit --prod --json`: zero reported advisories at audit time |
| Full dependency advisory check | Findings | Registry reports 11 package findings: 5 high, 6 moderate, all marked development dependencies |
| Common committed-secret patterns | No matches | Private-key markers, AWS access-key IDs, GitHub/Slack/live-key patterns; this is a bounded pattern scan |
| Cross-platform release checks | Configured, not independently observed | GitHub Actions covers Ubuntu/macOS/Windows and Node 22/24; those runners were not executed during this audit |

Initial localhost probes in the restricted environment returned `EPERM`. Re-running the normal workspace test command with localhost permission succeeded. The successful run uses each package's Vitest configuration, avoiding duplicate tests emitted under `dist`.

## Findings

Priorities below are the original release/work priorities, not CVSS scores. All findings were open at the initial audit; their current disposition is **resolved locally** in the remediation ledger above. The descriptions and probes below document the pre-fix behavior, not the current implementation.

| ID | Priority | Finding |
| --- | --- | --- |
| RC-001 | P1 | Escaped JSON secrets and reflected authentication headers bypass display redaction |
| RC-002 | P1 | CLI configuration and interactive prompt expose sensitive target URL values |
| RC-003 | P1 | The release package cannot be installed outside the workspace |
| RC-004 | P1 | Open-source license has not been selected or included |
| RC-005 | P2 | Development dependencies contain published security advisories |
| RC-006 | P2 | Midtrans normalization accepts an unsupported fraud outcome as `PAID` |
| RC-007 | P2 | YAML lifecycle events change the transaction identity |
| RC-008 | P2 | Multi-file JUnit output is invalid XML |
| RC-009 | P2 | Scenario step typos silently discard assertions |
| RC-010 | P2 | CLI error exits disagree with the documented contract |
| RC-011 | P2 | Declared minimum Node version is below the build dependency's requirement |
| RC-012 | P2 | Dashboard replay drops the acknowledged remote-target option and returns HTTP 500 |
| RC-013 | P3 | Interactive local sends unnecessarily enable the remote-target override |

### RC-001 — Redaction gaps

Locations: `packages/engine/src/format.ts:35` and `:95`.

`redactBody` serializes parsed JSON before applying literal secret replacement. A known synthetic secret containing a quote, such as `RC-synthetic-quote"value`, survives in a response like `{ "echo": secret }` because its serialized representation contains an escape. Parsing the displayed response recovers the original secret. This affects CLI JSON/text, dashboard history, and scenario JSON results that use the shared formatter.

The formatter also gathers request authentication values into `reflectedSecrets`, but uses that expanded list only for response bodies. A receiver reflecting a DOKU signature in `x-echo`, for example, exposes the signature in displayed response headers. Sensitive header names are masked correctly; the gap is a reflected authentication value under another name.

Confirmed offline probe result:

```json
{"escapedSecretLeaks":true,"reflectedSignatureHeaderLeaks":true}
```

Proposed fix: replace known secrets in parsed string values before serialization; apply the complete reflected-value set consistently to displayed headers and errors. Review decoded URL component handling for encoded secrets as part of the same formatter pass.

Acceptance: nested objects/arrays, JSON escapes, plaintext reflections, non-sensitive response header names, and invalid-authentication variants never reveal known credentials/authentication values after decoding display output. Exact unredacted wire bytes remain available for delivery/replay.

### RC-002 — Raw target in configuration output

Locations: `apps/cli/src/index.ts:73` and `apps/cli/src/interactive.ts:61`.

With `BAYARLAB_TARGET=http://127.0.0.1/webhook?token=RC-SYNTHETIC-URL-TOKEN`, `bayarlab config` exits successfully and prints that token unchanged. The interactive target prompt also includes the raw configured URL. This bypasses the engine's sensitive-query masking despite the configuration command promising secret-safe output.

Proposed fix: use a shared safe target representation in configuration and prompt output while retaining the original value internally.

Acceptance: target query credentials and known secrets are masked in configuration, prompts, and delivery displays, including encoded values; choosing the default target still uses the original URL.

### RC-003 — Distribution is still workspace-only

Locations: root `package.json`, `apps/cli/package.json`, runtime workspace package manifests, and `scripts/package-smoke.mjs`.

Every package is private and versioned `0.0.0`. The root package named `bayarlab` has no executable; the executable belongs to `@bayarlab/cli`. Thus the blueprint's `npx bayarlab` distribution path has not been implemented.

An actual `npm pack ./apps/cli` tarball was installed into an empty temporary consumer with no workspace links. Installation failed:

```text
npm error code EUNSUPPORTEDPROTOCOL
npm error Unsupported URL Type "workspace:": workspace:*
```

The archive contains 59 entries including source tests, compiled tests, configuration, and `tsconfig.tsbuildinfo`; no package file allowlist or release bundling/publishing strategy exists. Changing packing tooling alone is insufficient while required internal packages remain private/unpublished. The existing smoke script only confirms workspace resolution.

Proposed fix: choose the intended public executable package name and distribution strategy (a bundled artifact, or a publishable dependency graph with rewritten workspace references). Define package contents, version, license metadata, and dashboard asset inclusion.

Acceptance: pack the intended release artifact, install it outside the repo without workspace links, and run its installed executable for help, provider listing, all provider inspections, and dashboard asset loading. Verify `npx` semantics for the chosen package name without inadvertently executing an unrelated registry package.

### RC-004 — Missing license

The blueprint's repository layout includes `LICENSE`; the current repository has neither that file nor package license metadata. Contribution and conduct documents do not establish the project's license.

Proposed fix: the maintainer chooses the license and copyright attribution, then adds the license file and matching package metadata. This decision is required before describing the public release as open source.

Acceptance: repository and distributed artifact contain the selected license, and all published manifests identify it consistently.

### RC-005 — Development dependency advisories

Locations: `apps/web/package.json:36`, root `package.json:31`, and `pnpm-lock.yaml`.

`pnpm audit --json` reports 11 package findings (some share an advisory): 5 high and 6 moderate. The affected installed packages are Vite 7.1.7, Vitest/@vitest/mocker 4.1.0, and brace-expansion 5.0.9 via rimraf/glob/minimatch. The separate production-only query reports zero advisories.

Maintainer advisories confirm conditional development-server/file-access risks for [Vite](https://github.com/vitejs/vite/security/advisories/GHSA-fx2h-pf6j-xcff) and [Vitest's mocker](https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9), and recursion denial of service in [brace-expansion](https://github.com/juliangruber/brace-expansion/security/advisories/GHSA-qhr7-859c-m2p7). These do not establish a vulnerability in the compiled Fastify dashboard: it serves built assets and does not run Vite or the mocker. Default test scripts also use Vitest run mode rather than exposed browser/server mode.

Proposed fix: update affected development dependencies and regenerate the lockfile. At audit time, registry advisories identify Vite 7.3.5, Vitest 4.1.11, and brace-expansion 5.0.12 as versions covering the reported fixes within those release lines. Recheck advisories when applying updates rather than treating these versions as permanently sufficient.

Acceptance: repeat full/runtime dependency audits and build/test checks, recording any retained advisory with its actual exposure and rationale.

### RC-006 — Midtrans normalization is broader than its profile

Location: `packages/providers/midtrans/src/index.ts:223`.

The adapter returns `PAID` from any payload with `transaction_status: capture` and IDs, even when `fraud_status` is not `accept`. An offline call using `fraud_status: challenge` returned `PAID`. The selected card preset is accepted capture only; the [Midtrans notification guide](https://docs.midtrans.com/docs/https-notification-webhooks) conditions successful card handling on the accepted fraud outcome when that field is present.

Generated presets remain within the accepted profile, so this finding concerns the public normalization method, not the generated capture fixture or signer.

Proposed fix: validate the supported payment-type/fraud-state combination before normalization and reject unsupported combinations without expanding the adapter's product scope.

Acceptance: accepted capture normalizes correctly; challenge/deny and incompatible payment-type combinations are rejected or handled by an explicitly documented supported mapping.

### RC-007 — Lifecycle transaction identity changes

Location: `packages/scenario/src/runner.ts:209`; example: `examples/scenarios/lifecycle.scenario.yaml`.

A deterministic pending → settlement sequence with the same `variables.order_id` generates a new transaction ID at each non-duplicate step. Without a seed, each build likewise generates a new transaction ID. The YAML format has no transaction-ID variable to keep this identity stable. A local receiver probe confirmed `sameOrder: true`, `sameTransaction: false`, while the scenario reported PASS.

This does not faithfully test a receiver's lifecycle for one provider transaction. In contrast, the CLI chaos lifecycle already keeps transaction identity stable.

Proposed fix: represent transaction identity explicitly for a lifecycle and carry it across distinct events for that transaction, while preserving separate event identity and duplicate semantics. Update the lifecycle example and docs to show that contract.

Acceptance: pending/settlement for one lifecycle share order and transaction identifiers; duplicated settlement preserves the preceding event's exact bytes; unrelated transactions can still have distinct IDs.

### RC-008 — Multi-file JUnit is not one XML document

Location: `apps/cli/src/test-command.ts:102`; formatter: `packages/scenario/src/report.ts:85`.

`bayarlab test <directory> --output junit` prints a complete XML declaration/root for every file. A directory containing two zero-wait scenarios exits 0 but produces two declarations and fails XML parsing with `junk after document element`. This breaks the documented CI artifact workflow. Multi-file JSON also emits separate JSON documents; that behavior needs an explicit streaming contract or aggregation.

Proposed fix: aggregate JUnit suites under one root/declaration and define a single parseable JSON document or a clearly documented NDJSON mode.

Acceptance: parse multi-file JUnit with an XML parser, verify total/suite counts, and parse multi-file JSON according to its documented format. Preserve correct aggregate exit status.

### RC-009 — Misspelled step fields are ignored

Location: `packages/scenario/src/schema.ts:41`.

Event and wait schemas are not strict even though their surrounding schemas are. A step containing `exepct: { status: 401 }` parses successfully; the typo is removed and the intended rejection assertion disappears. The runner then uses its default 2xx assertion, allowing a miswritten negative scenario to test different behavior from what the author intended.

Confirmed probe: `typoAccepted: true`, `assertionPreserved: false`.

Proposed fix: reject unknown event/wait keys and ambiguous steps containing both event and wait fields.

Acceptance: misspelled assertion/options/wait keys fail configuration validation before delivery, with a useful path and exit code 2.

### RC-010 — Exit-code and error UX mismatch

Locations: `apps/cli/src/index.ts:245`, provider-list action, `apps/cli/src/test-command.ts`, and `packages/scenario/src/runner.ts:325`.

Offline command probes returned exit 1 for an unknown command, missing `send` arguments, and invalid `providers --output`. The invalid provider-list output also printed a stack trace. The guides reserve exit 1 for delivery/assertion failure and exit 2 for input/configuration errors. No-argument non-TTY invocation prints help but exits 1; its intended success/failure semantics should be stated consistently.

The YAML runner additionally catches some pre-delivery errors as failed steps, causing exit 1 rather than the documented configuration exit 2. For example, an unsupported event is treated as a failed report instead of preflight configuration failure.

Proposed fix: centralize Commander/input error handling, explicitly define non-TTY no-argument behavior, and preflight scenario configuration before sending. Keep expected transport failures distinct from configuration mistakes.

Acceptance: invalid arguments/configuration return 2 without an implementation stack; assertion failures return 1; successful runs return 0; help/no-argument behavior is documented and tested.

### RC-011 — Node minimum does not match the build tool

Locations: root `package.json:8`, README requirements, and installed Vite package metadata.

The project declares Node `>=22.0.0`, but Vite 7.1.7 declares `^20.19.0 || >=22.12.0`. With engine-strict enabled, the advertised Node 22.0–22.11 range cannot satisfy the source installation's build dependency. Current CI uses the latest patch in each Node major, so it does not exercise this boundary.

Proposed fix: align the declared/documented minimum with the selected toolchain and add a minimum-version check where appropriate.

Acceptance: install/build at the exact declared minimum Node version, plus the supported current LTS matrix.

### RC-012 — Dashboard replay loses target consent

Location: `apps/web/src/server/index.ts:270`.

Initial sends accept `allowRemoteTarget`, but replay only passes `timeoutMs` to delivery and does not translate thrown errors through the normal dashboard error formatter. In a process-only DNS stub mapping `prod.audit.local` to a local receiver, the acknowledged initial send returned 200 and replay returned 500 with a remote-target rejection. All traffic in this probe stayed on loopback.

Proposed fix: define consent for replay (retain the original acknowledged option or request an explicit replay acknowledgement) and format target-policy failures consistently. Keep byte-preserving replay and per-attempt target resolution.

Acceptance: an appropriately acknowledged same-target replay succeeds, an unacknowledged replay is denied predictably, and policy errors have an actionable API response rather than generic HTTP 500.

### RC-013 — Interactive override for local sends

Location: `apps/cli/src/interactive.ts:80`.

The expression `!remoteTarget || confirmed` sets `allowRemoteTarget` to true for local targets without a remote confirmation. For numeric private targets this has no practical effect, but for a hostname classified local before DNS it unnecessarily disables the engine's resolved-address remote guard. This is a static-code finding; a real DNS compromise was not exercised.

Proposed fix: pass the override only after a remote target was actually acknowledged; local sends should retain the engine's default resolved-address policy.

Acceptance: a local hostname resolving outside the allowed development range is denied without explicit acknowledgement; a confirmed remote target still works.

## Areas with positive evidence

- Midtrans's SHA-512 concatenation, Xendit's callback-token header, and DOKU's exact-byte digest/newline/HMAC construction agree with the scoped [Midtrans](https://docs.midtrans.com/docs/https-notification-webhooks), [Xendit](https://docs.xendit.co/docs/handling-webhooks), and [DOKU](https://developers.doku.com/get-started-with-doku-api/notification/best-practice) references reviewed during this audit. Existing fixed-vector and receiver tests passed. This conclusion applies to the selected product profiles.
- Delivery resolves all addresses, rejects unsafe addresses, pins the connection to a checked IP, and retains the original Host/TLS hostname. Redirects are recorded without following them. Body/response size bounds and HTTP timeout tests passed.
- Dashboard Host/Origin/session-token protections and byte-preserving local replay tests passed. React displays payloads as text rather than injecting receiver HTML.
- Composed Xendit DANA failure and Midtrans BNI cancellation fixtures are explicitly distinguished from sandbox captures. DOKU SNAP and query-bearing targets remain outside the implemented non-SNAP profile.
- Source installation and the main documented `pnpm ui` build path work in the local audit environment.

## Remaining public-release gates

1. Pin/review an identifiable candidate commit. This working tree has no HEAD and was not committed wholesale automatically.
2. Obtain passing results from the configured Ubuntu/macOS/Windows × Node 22.13.0/22/24 matrix, including installed-artifact smoke. Local success does not establish Windows/Linux or Node 24 success.
3. Recheck audits and the artifact against that same commit, then obtain maintainer release approval. Keep any new findings/dispositions explicit.
4. Start Phase 12 publication only after those gates pass. Do not assume the public registry name is owned/available or execute an unrelated registry package; the local smoke deliberately disables registry fallback.

The approved-fix step has now changed runtime behavior, packaging, tests, toolchain dependencies, and documentation as recorded above. No original technical finding is knowingly left open; public release approval still depends on candidate identity and cross-platform evidence. No package was published and no external issue or message was created.
