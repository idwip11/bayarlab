# Security policy

BayarLab is an early-stage local development simulator, not a payment gateway or a production webhook delivery service. It does not require real provider credentials. Treat all fixtures and default keys as synthetic and unsafe for production.

## Supported versions

Until the project publishes a stable release policy, security fixes are targeted at the latest version on the default branch. Older releases may not receive fixes.

## Reporting a vulnerability

Please report suspected vulnerabilities privately using GitHub's private vulnerability reporting feature for this repository. If that feature is unavailable, contact a repository maintainer privately through GitHub. Do not open a public issue or publish exploit details before maintainers have had a reasonable opportunity to investigate and coordinate a fix.

Include the affected version or commit, impact, reproduction steps, and any relevant configuration. Do not attach real credentials, payment data, or customer information. Maintainers will acknowledge and coordinate next steps, but this project does not currently promise a response or remediation timeline.

## Safe-use boundaries

- Use synthetic credentials and local/test endpoints only.
- The CLI can send HTTP requests; review target options carefully and never aim it at a production receiver.
- Dashboard history is in-memory and may contain raw request bytes to support replay. Keep the process local and do not expose its port to untrusted networks.
- Redaction is for display, not a guarantee that arbitrary secrets or personal data can never appear in memory, logs, or user-created fixtures.
- Report suspected secret leakage, unsafe target validation, authentication/signature errors, or unintended network exposure privately.
