import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

const clientId = process.env.BAYARLAB_DOKU_CLIENT_ID ?? "MCH-BAYARLAB-LOCAL";
const secret = process.env.BAYARLAB_DOKU_SECRET ?? "bayarlab-local-doku-secret";

createServer((request, response) => {
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    if (request.method !== "POST" || request.url !== "/webhook/doku") {
      response.writeHead(404).end();
      return;
    }
    const body = Buffer.concat(chunks);
    const requestId = request.headers["request-id"];
    const timestamp = request.headers["request-timestamp"];
    const claimed = request.headers.signature;
    if (
      request.headers["client-id"] !== clientId ||
      typeof requestId !== "string" ||
      typeof timestamp !== "string" ||
      typeof claimed !== "string"
    ) {
      response.writeHead(401).end("invalid DOKU signature");
      return;
    }
    const digest = createHash("sha256").update(body).digest("base64");
    const components = [
      `Client-Id:${clientId}`,
      `Request-Id:${requestId}`,
      `Request-Timestamp:${timestamp}`,
      `Request-Target:${request.url}`,
      `Digest:${digest}`,
    ].join("\n");
    const expected = `HMACSHA256=${createHmac("sha256", secret).update(components).digest("base64")}`;
    const actualBytes = Buffer.from(claimed);
    const expectedBytes = Buffer.from(expected);
    if (
      actualBytes.length !== expectedBytes.length ||
      !timingSafeEqual(actualBytes, expectedBytes)
    ) {
      response.writeHead(401).end("invalid DOKU signature");
      return;
    }
    try {
      const payload = JSON.parse(body.toString("utf8"));
      if (
        payload.service?.id !== "VIRTUAL_ACCOUNT" ||
        payload.acquirer?.id !== "BANK_MANDIRI" ||
        payload.transaction?.status !== "SUCCESS"
      ) {
        response.writeHead(400).end("unsupported DOKU event");
        return;
      }
      process.stdout.write(`DOKU ${payload.order.invoice_number} ${requestId}\n`);
      response.writeHead(200).end("ok");
    } catch {
      response.writeHead(400).end("invalid JSON");
    }
  });
}).listen(3000, "127.0.0.1", () => {
  process.stdout.write("DOKU test receiver listening on http://127.0.0.1:3000/webhook/doku\n");
});
