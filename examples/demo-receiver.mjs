import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

const host = "127.0.0.1";
const port = 3000;
const secret = process.env.BAYARLAB_DEMO_SECRET ?? "bayarlab-local-test-key";
const maxBytes = 1024 * 1024;

createServer((request, response) => {
  if (request.method !== "POST" || request.url !== "/webhook") {
    response.writeHead(404).end();
    return;
  }
  const chunks = [];
  let bytes = 0;
  request.on("data", (chunk) => {
    bytes += chunk.length;
    if (bytes > maxBytes) {
      response.writeHead(413).end();
      request.destroy();
      return;
    }
    chunks.push(chunk);
  });
  request.on("end", () => {
    const body = Buffer.concat(chunks);
    const expected = Buffer.from(
      createHmac("sha256", secret).update(request.url).update(".").update(body).digest("hex"),
    );
    const received = Buffer.from(String(request.headers["x-bayarlab-signature"] ?? ""));
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      response.writeHead(401).end("Invalid synthetic signature");
      return;
    }
    response
      .writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify({ acknowledged: true }));
  });
}).listen(port, host, () => {
  process.stdout.write(`Demo receiver listening on http://${host}:${port}/webhook\n`);
});
