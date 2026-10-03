import { execFile } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const exec = promisify(execFile);
const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));

it("runs CLI duplicates and reversed lifecycle, with machine-readable assertions and exit codes", async () => {
  const received: Record<string, unknown>[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      received.push(JSON.parse(Buffer.concat(chunks).toString()));
      res.writeHead(200).end("accepted");
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No port");
    const args = ["--to", `http://127.0.0.1:${address.port}`, "--output", "json"];
    const duplicate = await exec(process.execPath, [
      cli,
      "chaos",
      "midtrans",
      "settlement",
      "--duplicate",
      "3",
      ...args,
    ]);
    const report = JSON.parse(duplicate.stdout);
    expect(report.passed).toBe(true);
    expect(report.attempts).toHaveLength(3);
    expect(received[0]).toEqual(received[1]);
    expect(received[1]).toEqual(received[2]);
    expect(duplicate.stdout).not.toContain(String(received[0]?.signature_key));
    const lifecycle = await exec(process.execPath, [
      cli,
      "chaos",
      "midtrans",
      "lifecycle",
      "--out-of-order",
      ...args,
    ]);
    expect(
      JSON.parse(lifecycle.stdout).attempts.map((item: { step: string }) => item.step),
    ).toEqual(["settlement", "pending"]);
    expect(received[3]?.order_id).toBe(received[4]?.order_id);
    expect(received[3]?.transaction_id).toBe(received[4]?.transaction_id);
    await expect(
      exec(process.execPath, [
        cli,
        "chaos",
        "midtrans",
        "settlement",
        "--invalid-signature",
        "--expect-status",
        "401",
        ...args,
      ]),
    ).rejects.toMatchObject({ code: 1 });
    const before = received.length;
    await expect(
      exec(process.execPath, [cli, "chaos", "midtrans", "settlement", "--duplicate", "0", ...args]),
    ).rejects.toMatchObject({ code: 2 });
    expect(received).toHaveLength(before);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
