# Example webhook receivers

These examples show a small Midtrans Classic notification endpoint in Express and in a Next.js App Router `route.js`. They only verify the synthetic BNI VA/card fixtures supported by BayarLab. They do not connect to Midtrans or prove production integration. Keep the same local test key on the sender and receiver, use a loopback URL, and never substitute a production key.

The shared verifier checks the fields used by the Midtrans SHA-512 signature and compares fixed-length digests with `timingSafeEqual`. It expects `gross_amount` as the provider-shaped string. The Express handler uses `express.raw()` before parsing the JSON; the Next.js Route Handler reads the request JSON once. These choices are specific to this signature formula, which does not hash the complete raw JSON body.

## Express

Install the example's isolated dependency from the repository root, then start the receiver:

```bash
npm install --prefix examples/express
BAYARLAB_MIDTRANS_TEST_KEY=bayarlab-local-test-key node examples/express/midtrans-webhook.mjs
```

In another terminal:

```bash
pnpm --filter @bayarlab/cli start send midtrans settlement \
  --to http://127.0.0.1:3000/webhook/midtrans
```

The receiver binds to `127.0.0.1`. Invalid JSON returns `400`; an invalid or missing signature returns `401`; an accepted fixture receives a `200` response.

## Next.js App Router

Copy `examples/shared/verify-midtrans.mjs` and `examples/nextjs/app/api/webhooks/midtrans/route.js` into the corresponding locations in an App Router project. From its root:

```bash
npm install
BAYARLAB_MIDTRANS_TEST_KEY=bayarlab-local-test-key npm run dev
```

Then point BayarLab to `http://127.0.0.1:3000/api/webhooks/midtrans`. The example selects the Node.js runtime because it imports Node's crypto API. It returns `400` for malformed JSON, `401` for an invalid signature, and `200` for an accepted fixture. The current Next.js Route Handler convention uses a `POST(request)` export and the standard `Request.json()` method. See the [official Route Handler documentation](https://nextjs.org/docs/app/api-reference/file-conventions/route).

The sample pins Express 5.2.1 in its own private example manifest, leaving the BayarLab workspace dependency graph unchanged. Express's built-in `express.raw()` supplies a `Buffer` to the route; see the [official Express middleware guide](https://expressjs.com/en/guide/using-middleware/).

This is a learning example, not production receiver scaffolding: production systems need provider-specific event validation, idempotency and business processing, key rotation, observability, and a deliberate persistence policy.
