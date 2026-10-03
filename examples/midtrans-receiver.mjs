import { createHash, timingSafeEqual } from "node:crypto";
import http from "node:http";

const secret = process.env.BAYARLAB_MIDTRANS_TEST_KEY ?? "bayarlab-local-test-key";
const port = Number(process.env.PORT ?? "3000");
const seen = new Set();
let deliveries = 0;
let duplicates = 0;

http
  .createServer((request, response) => {
    if (request.method === "GET" && request.url === "/state") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ uniqueEvents: seen.size, deliveries, duplicates }));
      return;
    }
    if (request.method !== "POST" || request.url !== "/webhook") {
      response.writeHead(404).end();
      return;
    }
    const chunks = [];
    let bytes = 0;
    request.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > 1024 * 1024) request.destroy();
      else chunks.push(chunk);
    });
    request.on("end", () => {
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (
          typeof body.order_id !== "string" ||
          typeof body.status_code !== "string" ||
          typeof body.gross_amount !== "string" ||
          typeof body.signature_key !== "string" ||
          !/^[0-9a-f]{128}$/.test(body.signature_key)
        )
          throw new Error("Missing Midtrans signature fields");
      } catch {
        response.writeHead(400).end("invalid payload");
        return;
      }
      const expected = createHash("sha512")
        .update(`${body.order_id}${body.status_code}${body.gross_amount}${secret}`)
        .digest("hex");
      const valid = timingSafeEqual(
        Buffer.from(body.signature_key, "hex"),
        Buffer.from(expected, "hex"),
      );
      if (!valid) {
        response.writeHead(401).end("invalid signature");
        return;
      }
      const key = `${body.order_id}:${body.transaction_id}:${body.transaction_status}`;
      const duplicate = seen.has(key);
      seen.add(key);
      deliveries += 1;
      if (duplicate) duplicates += 1;
      process.stdout.write(`${duplicate ? "duplicate" : "accepted"} ${key}\n`);
      response.writeHead(200).end(duplicate ? "duplicate acknowledged" : "ok");
    });
  })
  .listen(port, "127.0.0.1", () => {
    process.stdout.write(`Midtrans test receiver listening on http://127.0.0.1:${port}/webhook\n`);
  });
