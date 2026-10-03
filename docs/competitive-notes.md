# Competitive notes and product validation

Research date: **2026-09-15**. Method: official documentation and project-maintainer descriptions. This is desk research, not a hands-on benchmark or proof of demand. The BayarLab implementation does not yet exist.

## Existing alternatives and overlap

| Alternative | Documented capability | Overlap | BayarLab product hypothesis |
| --- | --- | --- | --- |
| Midtrans sandbox | Bank/payment-specific simulators operate on sandbox payment references. [Testing guide](https://docs.midtrans.com/docs/testing-payment-on-sandbox) | Realistic payment outcomes and callbacks | Local synthetic events remove repeated sandbox transaction setup for receiver-only debugging. Sandbox remains the stronger check for actual provider integration. |
| Postman | Pre-request JavaScript can populate variables, headers, and bodies; collections reuse scripts and sequence requests. [Scripting docs](https://learning.postman.com/docs/tests-and-scripts/write-scripts/pre-request-scripts/) | Sending, dynamic payloads, scripted signing, workflows | Maintained provider presets may reduce the amount of scripting and schema maintenance required from each team. |
| Webhook.site | Request forwarding, including CLI streaming to localhost. [Official FAQ](https://docs.webhook.site/) | Capturing and forwarding callbacks to a local receiver | Generating a chosen payment notification locally may be useful before any incoming callback is available. |
| ngrok | Local inspection supports replay and modification of captured requests. [Inspection docs](https://ngrok.com/docs/gateway/agent/web-inspection-interface) | Inspection, repeat delivery, request editing | Provider-aware generation and re-signing add value beyond replaying captured traffic. Replay alone is not a differentiator. |
| WireMock | Stateful scenarios, configurable delays and fault injection. [Stateful scenarios](https://wiremock.org/docs/stateful-behaviour/), [fault simulation](https://wiremock.org/docs/simulating-faults/) | Deterministic simulations and reliability tests | BayarLab can package Indonesian payment-specific contracts and failure cases so users do not start from generic stubs. |
| Rute Bayar | Maintainer describes a Go payment router/daemon with payment operations, webhook verification/forwarding, and persisted raw traffic. [Repository README](https://github.com/pendig/rute-bayar) | Indonesian providers, CLI, provider adapters, webhook debugging | BayarLab focuses on synthetic outbound test events without provider setup. Router users may use it to exercise their receiving handlers. |

These comparisons describe the reviewed capabilities, not exhaustive feature absences. Generic tools can be extended. Provider-aware convenience must be demonstrated in the first-run experience rather than assumed to be exclusive.

## Positioning decision

Use: **“Test your Midtrans webhook locally with ready-made payment events, signatures, and replay.”** This is a planned V0.1 promise; use it as a shipped claim only after acceptance passes.

Keep the broader Indonesian-provider tagline, with precise support labels. Avoid promising all Midtrans methods, all three providers at launch, exact production retry timing, or proof that a merchant's payment logic is correct.

The internal “Postman for Indonesian payment webhooks” analogy can explain the category, but the public lead should describe the task users accomplish. Postman already supports scripting; “we can send POST” or “we have replay” is insufficient positioning.

## What must make BayarLab worth using

1. A user selects a documented product profile and event without finding and repairing a sample payload.
2. Normal variable edits produce correctly authenticated requests with synthetic credentials.
3. Duplicate mode preserves transaction identity and exact payload; invalid-authentication mode changes authentication deliberately.
4. The inspector makes it clear whether the endpoint acknowledged, rejected, or timed out.
5. Each fixture states its source, supported schema, and limitations.

In V0.2, reusable lifecycle/chaos scenarios and CI output can extend this value. They must remain visible as later capabilities in MVP messaging.

## Validation protocol for the first working MVP

Recruit at least three backend/full-stack developers who have implemented payment notifications. Use synthetic test data and the same receiving application for both BayarLab and their usual tool. User recruitment or external messages have not been performed in Phase 0.

Tasks: send a successful event, repeat the same event without double fulfillment, and send an invalid signature and observe rejection. Record completion time, setup steps, documentation lookups, errors, and whether the participant understands what a passing HTTP response does and does not establish.

Target: each participant can complete the three tasks unaided; first successful event in under 60 seconds once the receiver and runtime are ready. Report package download/install time separately, as well as the original install-to-first-event target. A small sample identifies usability problems, not statistical proof of market demand.

Ask which current workflow this replaces, what they would still need the provider sandbox for, and whether they would use the tool for their next integration. If users prefer an existing collection, investigate missing presets, setup friction, and clarity before adding providers.

## Unvalidated assumptions

- Developers want a standalone tool rather than a maintained Postman collection or fixtures package.
- BNI VA plus two card outcomes covers enough early debugging needs.
- CLI plus a small dashboard is more useful than either alone.
- Teams will maintain versioned scenarios for CI once V0.2 exists.
- The package name must be checked for availability and ownership before publishing. On 2026-10-03, `npm view bayarlab name version` returned E404. This confirms there is no publicly readable package at that registry path in this query; npm's response also covers packages the caller cannot access, so it does not establish ownership or guarantee that the name can be published. The maintainer designated `https://github.com/idwip11/bayarlab`; it is confirmed public and the source has been pushed. Its cross-platform CI rerun is pending.

Phase 0 establishes a concrete product direction and source-backed technical scope. Demand, installation speed, usability, and sandbox fidelity remain measurable follow-up work.
