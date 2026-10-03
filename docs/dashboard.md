# Local dashboard (Phase 5)

Build the workspace, then start the dashboard:

```bash
pnpm ui
```

It serves at `http://127.0.0.1:8787` by default. Use `node apps/cli/dist/index.js ui --port 8790` after a build to select another port. The server binds only to IPv4 loopback; it is not an internet-facing service.

The dashboard provides six Midtrans presets, Xendit Payments API v3 DANA capture/failure presets, and DOKU non-SNAP Mandiri VA success, plus editable target/amount/order ID variables, payload preview, valid or deliberately invalid authentication, request/response/cURL inspectors, elapsed time, history, and replay. “Replay original bytes” uses the unredacted in-memory `WireRequest`; it does not rebuild or re-sign the event. History is limited to 100 records and disappears when the server exits.

## Local API boundary

The React client talks only to the Fastify API on the same origin. `GET /api/session` supplies a random process-local token; every state-changing endpoint (`preview`, `send`, and `replay`) requires it in `x-bayarlab-session`. Requests with a non-local Host header or a cross-origin browser Origin receive HTTP 403. No CORS policy exposes the API to other origins.

Request/response displays mask `signature_key`, `x-callback-token`, DOKU `Signature`, secrets, sensitive headers, and sensitive URL query values. The cURL panel intentionally uses a redacted authentication template. A public or production-like target requires the explicit acknowledgement checkbox and still passes through the engine's address validation. The dashboard never writes configuration, history, or secrets to disk.

Replay retains the original record's remote-target acknowledgement for that same target. Every replay still re-resolves and validates the address; no acknowledgement can bypass unsafe-address rejection. Unacknowledged sends/replays that resolve outside development ranges are rejected. Target-policy failures return HTTP 400 with a typed error code/message rather than HTTP 500.

This interface is a local test tool, not a Midtrans transaction console: the events are synthetic and cannot be checked through the real Midtrans GET Status endpoint.
