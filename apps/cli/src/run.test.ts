import { createHash, createHmac } from "node:crypto";
import http from "node:http";

import { describe, expect, it } from "vitest";

import { loadRuntimeConfig } from "./config.js";
import { SessionHistory } from "./history.js";
import { formatSend, replayMidtrans, sendMidtrans, sendProvider } from "./run.js";

describe("CLI delivery session", () => {
  it("repeats and replays the original signed bytes", async () => {
    const received: string[] = [];
    const server = http.createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        received.push(Buffer.concat(chunks).toString("utf8"));
        response.writeHead(200).end("ok");
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing test address.");
      const history = new SessionHistory();
      const config = loadRuntimeConfig({});
      const sent = await sendMidtrans(
        {
          provider: "midtrans",
          scenario: "settlement",
          target: `http://127.0.0.1:${address.port}/webhook`,
          repeat: 2,
          sameEventId: true,
        },
        config,
        history,
      );
      const latest = history.latest();
      if (!latest) throw new Error("Expected a history record.");
      const replayed = await replayMidtrans(latest.request, sent.secret, {}, config, history);
      expect(sent.results).toHaveLength(2);
      expect(replayed.results).toHaveLength(1);
      expect(received).toHaveLength(3);
      expect(received[0]).toBe(received[1]);
      expect(received[1]).toBe(received[2]);
      expect(sent.results[0]?.requestId).not.toBe(sent.results[1]?.requestId);
      expect(replayed.results[0]?.requestId).not.toBe(sent.results[1]?.requestId);
      expect(JSON.parse(formatSend(sent, "json"))).toMatchObject({ attempts: [{}, {}] });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("requires an explicit same-event-id guard for duplicate delivery", async () => {
    await expect(
      sendMidtrans(
        {
          provider: "midtrans",
          scenario: "settlement",
          target: "http://127.0.0.1:3000/webhook",
          repeat: 2,
        },
        loadRuntimeConfig({}),
      ),
    ).rejects.toThrow("--repeat > 1 requires --same-event-id");
  });

  it("sends Xendit callback-token variants and identical duplicate bytes", async () => {
    const received: Array<{ body: string; token: string | undefined }> = [];
    const server = http.createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        const token = request.headers["x-callback-token"] as string | undefined;
        received.push({ body: Buffer.concat(chunks).toString("utf8"), token });
        response.writeHead(token === "xendit-local-secret" ? 200 : 401).end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing test address.");
      const config = loadRuntimeConfig({ BAYARLAB_XENDIT_CALLBACK_TOKEN: "xendit-local-secret" });
      const input = {
        provider: "xendit",
        scenario: "capture",
        target: `http://127.0.0.1:${address.port}/webhook`,
      };
      const valid = await sendProvider({ ...input, repeat: 2, sameEventId: true }, config);
      const invalid = await sendProvider(
        { ...input, invalidSignature: true, expectStatus: 401 },
        config,
      );
      expect(valid.results.map((item) => item.response?.status)).toEqual([200, 200]);
      expect(invalid.results[0]?.response?.status).toBe(401);
      expect(received[0]?.body).toBe(received[1]?.body);
      expect(received[0]?.token).toBe("xendit-local-secret");
      expect(received[2]?.token).not.toBe("xendit-local-secret");
      expect(formatSend(valid, "json")).not.toContain("xendit-local-secret");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("sends DOKU non-SNAP signed copies and a corrupted signature", async () => {
    const received: Array<{
      body: string;
      signature: string | undefined;
      requestId: string | undefined;
    }> = [];
    const server = http.createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        const body = Buffer.concat(chunks);
        received.push({
          body: body.toString("utf8"),
          signature: request.headers.signature as string | undefined,
          requestId: request.headers["request-id"] as string | undefined,
        });
        const digest = createHash("sha256").update(body).digest("base64");
        const signedText = [
          `Client-Id:${request.headers["client-id"]}`,
          `Request-Id:${request.headers["request-id"]}`,
          `Request-Timestamp:${request.headers["request-timestamp"]}`,
          `Request-Target:${request.url}`,
          `Digest:${digest}`,
        ].join("\n");
        const expected = `HMACSHA256=${createHmac("sha256", "bayarlab-local-doku-secret").update(signedText).digest("base64")}`;
        response.writeHead(request.headers.signature === expected ? 200 : 401).end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing test address.");
      const config = loadRuntimeConfig({});
      const input = {
        provider: "doku",
        scenario: "success",
        target: `http://127.0.0.1:${address.port}/webhook`,
      };
      const valid = await sendProvider({ ...input, repeat: 2, sameEventId: true }, config);
      const invalid = await sendProvider(
        { ...input, invalidSignature: true, expectStatus: 401 },
        config,
      );
      expect(valid.results.map((item) => item.response?.status)).toEqual([200, 200]);
      expect(invalid.results[0]?.response?.status).toBe(401);
      expect(received[0]).toEqual(received[1]);
      expect(received[2]?.signature).not.toBe(received[1]?.signature);
      expect(formatSend(valid, "json")).not.toContain(config.dokuSecret);
      expect(formatSend(valid, "json")).not.toContain(received[0]?.signature ?? "not-present");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
