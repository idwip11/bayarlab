# Contributing to BayarLab

Thanks for helping improve BayarLab. Contributions can include bug fixes, provider-fidelity research, tests, documentation, and small usability improvements. The project is an early-stage local simulator; keep the documented provider scope and security boundaries intact.

## Before you start

- Read the [Code of Conduct](CODE_OF_CONDUCT.md) and the [security policy](SECURITY.md).
- For a new provider or product profile, read the [provider adapter guide](docs/provider-adapter-guide.md) and open an issue first if the scope or source evidence is unclear.
- Check existing issues and pull requests to avoid duplicate work. For substantial changes, describe the problem and proposed scope in an issue before investing in an implementation.

## Local setup

Use Node.js 22.13.0 or newer and pnpm 11 or newer. From the repository root:

```bash
pnpm install
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm smoke:packages
pnpm smoke:release
```

`smoke:packages` runs the built CLI and therefore follows `pnpm build`. Provider tests and scenario fixtures must use synthetic inputs; no real provider credentials or payment traffic are needed. For manual end-to-end checks, use the loopback receivers documented in the README.

## Changes and pull requests

Keep a change focused and preserve unrelated work. Add or update tests for behavior changes and documentation for user-visible behavior or provider-scope changes. Do not silently broaden an adapter's supported event/product matrix. Include the source and date for provider claims, distinguish provider examples from composed fixtures and sandbox captures, and state deviations from the reference behavior.

Before opening a pull request, run the applicable checks above and describe what changed, how it was verified, and any remaining limitations. Include screenshots only when a dashboard change benefits from visual review. Never include secrets, real customer data, or production webhook payloads.

## Adding or changing provider support

Follow the adapter guide checklist. In particular, preserve the provider's exact signing inputs and serialized bytes, keep each product family's authentication separate, add independently checked test vectors and fixtures, update the provider matrix and adapter documentation, and verify redaction. A generic normalized payment state is not evidence that a provider emits a matching webhook.

## Issue labels

The suggested GitHub labels and descriptions are maintained in [`.github/labels.yml`](.github/labels.yml). Repository maintainers can apply them with their preferred label-sync tooling; no workflow changes repository labels automatically.
