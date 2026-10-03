# Provider adapter guide

This guide is the implementation checklist for adding a provider or a separately authenticated product family. BayarLab aims for faithful, narrow profiles, not a generic payment-gateway abstraction that invents provider behavior.

## 1. Establish the scope and evidence

Before coding, identify the exact API family, version baseline, country, payment channel, and supported notification scenarios. Record official reference URLs and the review date in `docs/provider-matrix.md` and the provider-specific guide. Classify every fixture as an official documentation example, a composition of documented fields/semantics, or a sandbox capture. Do not call a composed fixture “captured” or imply certification.

Do not infer callback events from generic payment states. If a source does not establish a channel-specific pending, failed, expired, or reversal callback, leave that scenario unsupported and record it as a follow-up.

## 2. Implement the adapter contract

Use an existing provider package under `packages/providers/` as a structural reference, but do not copy its signer or authentication scheme as a default. Each adapter should expose a manifest and the provider-contract methods for listing supported scenarios, building a typed event, and signing the serialized request using the contract's effective target information.

Keep provider payloads and identifiers provider-shaped. Keep internal metadata out of the wire body unless the provider contract defines those fields. Use deterministic fixture data where practical and preserve provider-required number/string formatting, timestamp timezone, field casing, and optional-field rules.

## 3. Preserve signing and transport fidelity

- Serialize the request body once and sign the exact bytes that delivery will send.
- Use the exact documented canonicalization and component ordering, including path/query rules, separators, encoding, digest encoding, casing, and trailing-newline behavior.
- Keep separate authentication contracts separate, even when they belong to the same vendor (for example, SNAP and non-SNAP families).
- Never transmit a secret or callback token when the provider only expects a derived signature/token header.
- Corrupt the resulting authentication value after signing for invalid-signature scenarios; avoid unrelated payload changes.
- Add fixed test vectors whose expected result was checked independently from the production signer. Cover at least one mutation of each security-relevant signing input.
- Reject target forms whose canonicalization is undocumented or unsupported instead of guessing.

Delivery policy (target validation, no automatic redirects/retries, bounded response capture) belongs to the shared engine unless the plan explicitly approves a provider-specific behavior. Document any known fidelity deviation.

## 4. Add tests and register the profile

Add tests for manifest metadata, every supported scenario's schema and stable identifiers, exact serialized body bytes, valid authentication, invalid authentication, and redaction. Add receiver/integration coverage when an independent verifier is practical. Update CLI provider selection, scenario resolution, default test configuration, examples, and dashboard choices as needed; follow existing package registrations rather than relying on implicit provider-name strings.

Update the provider matrix, provider-specific documentation, README scope summary, and any relevant scenario examples. State what is deliberately not implemented. Never add live credentials to source, fixtures, tests, or CI.

## Review checklist

- [ ] Product family and event scope have official references and a review date.
- [ ] Fixture provenance is explicit; composed and captured evidence are distinguished.
- [ ] Manifest advertises only tested capabilities.
- [ ] Signer uses exact bytes and has independently checked vectors.
- [ ] Mutating signed inputs causes independent verification to fail.
- [ ] Unsigned-field behavior is not incorrectly asserted as authenticated.
- [ ] Secret, token, body, URL, and header display redaction is covered.
- [ ] CLI/scenario/dashboard configuration and examples are consistent.
- [ ] Cross-platform build, lint, typecheck, tests, and package smoke checks pass.
- [ ] Provider docs and known deviations are updated.
