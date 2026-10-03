import express from "express";

import { verifyMidtrans } from "../shared/verify-midtrans.mjs";

const app = express();
const port = Number(process.env.PORT ?? 3000);
const serverKey = process.env.BAYARLAB_MIDTRANS_TEST_KEY ?? "bayarlab-local-test-key";

app.post(
  "/webhook/midtrans",
  express.raw({ type: "application/json", limit: "1mb" }),
  (request, response) => {
    let payload;
    try {
      if (!Buffer.isBuffer(request.body)) throw new Error("Expected an application/json body");
      payload = JSON.parse(request.body.toString("utf8"));
    } catch {
      response.status(400).json({ error: "invalid JSON payload" });
      return;
    }
    if (!verifyMidtrans(payload, serverKey)) {
      response.status(401).json({ error: "invalid Midtrans signature" });
      return;
    }
    response.status(200).json({ received: true, order_id: payload.order_id });
  },
);

app.listen(port, "127.0.0.1", () => {
  process.stdout.write(`Synthetic Midtrans receiver listening on http://127.0.0.1:${port}/webhook/midtrans\n`);
});
