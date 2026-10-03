import { createServer } from "node:http";

const expectedToken = process.env.BAYARLAB_XENDIT_CALLBACK_TOKEN ?? "bayarlab-local-xendit-token";

createServer((request, response) => {
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    if (request.method !== "POST" || request.url !== "/webhook") {
      response.writeHead(404).end();
      return;
    }
    if (request.headers["x-callback-token"] !== expectedToken) {
      response.writeHead(401).end("invalid callback token");
      return;
    }
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (
        !["payment.capture", "payment.failure"].includes(body.event) ||
        body.data?.channel_code !== "DANA" ||
        body.data?.country !== "ID"
      ) {
        response.writeHead(400).end("unsupported event");
        return;
      }
      process.stdout.write(`${body.event} ${body.data.payment_id}\n`);
      response.writeHead(200).end("ok");
    } catch {
      response.writeHead(400).end("invalid JSON");
    }
  });
}).listen(3000, "127.0.0.1", () => {
  process.stdout.write("Xendit test receiver listening on http://127.0.0.1:3000/webhook\n");
});
