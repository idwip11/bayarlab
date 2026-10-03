import dns from "node:dns/promises";
import http from "node:http";
import { syncBuiltinESMExports } from "node:module";

import { describe, expect, it, vi } from "vitest";

import { createDashboardServer } from "./index.js";

const host = { host: "127.0.0.1:8787" };

describe("local dashboard API", () => {
  it("retains explicit replay consent and translates re-resolved target-policy failures", async () => {
    const received: string[] = [];
    const receiver = http.createServer((request, response) => {
      let body = "";
      request.on("data", (chunk: Buffer) => {
        body += chunk;
      });
      request.on("end", () => {
        received.push(body);
        response.writeHead(200).end("ok");
      });
    });
    await new Promise<void>((resolve) => receiver.listen(0, "127.0.0.1", resolve));
    let resolvedAddress = "127.0.0.1";
    const lookup = vi
      .spyOn(dns, "lookup")
      .mockImplementation((async () => [
        { address: resolvedAddress, family: 4 },
      ]) as unknown as typeof dns.lookup);
    syncBuiltinESMExports();
    const app = createDashboardServer();
    try {
      const address = receiver.address();
      if (!address || typeof address === "string") throw new Error("Missing receiver address.");
      const { token } = (
        await app.inject({ method: "GET", url: "/api/session", headers: host })
      ).json() as { token: string };
      const headers = { ...host, "x-bayarlab-session": token };
      const payload = {
        provider: "midtrans",
        scenario: "settlement",
        target: `http://prod.audit.local:${address.port}/webhook`,
      };
      const denied = await app.inject({ method: "POST", url: "/api/send", headers, payload });
      expect(denied.statusCode).toBe(400);
      expect(denied.json().code).toBe("REMOTE_TARGET_NOT_ALLOWED");
      const sent = await app.inject({
        method: "POST",
        url: "/api/send",
        headers,
        payload: { ...payload, allowRemoteTarget: true },
      });
      expect(sent.statusCode).toBe(200);
      const replay = {
        method: "POST" as const,
        url: `/api/replay/${sent.json().id}`,
        headers,
        payload: {},
      };
      expect((await app.inject(replay)).statusCode).toBe(200);
      expect(received).toHaveLength(2);
      expect(received[0]).toBe(received[1]);
      resolvedAddress = "169.254.169.254";
      const unsafe = await app.inject(replay);
      expect(unsafe.statusCode).toBe(400);
      expect(unsafe.json().code).toBe("UNSAFE_TARGET");
      expect(received).toHaveLength(2);
      resolvedAddress = "127.0.0.1";
      const local = await app.inject({
        method: "POST",
        url: "/api/send",
        headers,
        payload: { ...payload, target: `http://localhost:${address.port}/webhook` },
      });
      expect(local.statusCode).toBe(200);
      resolvedAddress = "8.8.8.8";
      const remote = await app.inject({ ...replay, url: `/api/replay/${local.json().id}` });
      expect(remote.statusCode).toBe(400);
      expect(remote.json().code).toBe("REMOTE_TARGET_NOT_ALLOWED");
      expect(received).toHaveLength(3);
    } finally {
      lookup.mockRestore();
      syncBuiltinESMExports();
      await app.close();
      await new Promise<void>((resolve) => receiver.close(() => resolve()));
    }
  });
  it("requires local origin and a session token for state-changing actions", async () => {
    const app = createDashboardServer();
    try {
      const session = await app.inject({ method: "GET", url: "/api/session", headers: host });
      const token = (session.json() as { token: string }).token;
      expect(token).toBeTruthy();
      expect(
        (await app.inject({ method: "POST", url: "/api/preview", headers: host, payload: {} }))
          .statusCode,
      ).toBe(403);
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/preview",
            headers: { ...host, origin: "http://attacker.example", "x-bayarlab-session": token },
            payload: {},
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await app.inject({
            method: "GET",
            url: "/api/session",
            headers: { host: "attacker.example" },
          })
        ).statusCode,
      ).toBe(403);
    } finally {
      await app.close();
    }
  });

  it("builds a redacted preview and preserves raw bytes for replay", async () => {
    const received: string[] = [];
    const receiver = http.createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        received.push(Buffer.concat(chunks).toString("utf8"));
        response.writeHead(200).end("ok");
      });
    });
    await new Promise<void>((resolve) => receiver.listen(0, "127.0.0.1", resolve));
    const app = createDashboardServer();
    try {
      const address = receiver.address();
      if (!address || typeof address === "string") throw new Error("Missing receiver address.");
      const token = (
        await app.inject({ method: "GET", url: "/api/session", headers: host })
      ).json() as { token: string };
      const payload = {
        provider: "midtrans",
        scenario: "settlement",
        target: `http://127.0.0.1:${address.port}/webhook`,
        amount: 150_000,
      };
      const headers = { ...host, "x-bayarlab-session": token.token };
      const preview = await app.inject({ method: "POST", url: "/api/preview", headers, payload });
      expect(preview.statusCode).toBe(200);
      expect(preview.body).toContain("[REDACTED]");
      expect(preview.body).not.toContain("bayarlab-local-test-key");
      const sent = await app.inject({ method: "POST", url: "/api/send", headers, payload });
      expect(sent.statusCode).toBe(200);
      const sentRecord = sent.json() as { id: string; result: { response?: { status: number } } };
      expect(sentRecord.result.response?.status).toBe(200);
      const replayed = await app.inject({
        method: "POST",
        url: `/api/replay/${sentRecord.id}`,
        headers,
        payload: {},
      });
      expect(replayed.statusCode).toBe(200);
      expect(received).toHaveLength(2);
      expect(received[0]).toBe(received[1]);
      const history = (
        await app.inject({ method: "GET", url: "/api/history", headers: host })
      ).json() as { records: unknown[] };
      expect(history.records).toHaveLength(2);
    } finally {
      await app.close();
      await new Promise<void>((resolve, reject) =>
        receiver.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("offers Xendit DANA and never reveals the callback token in preview or cURL", async () => {
    const app = createDashboardServer({ config: { xenditToken: "dashboard-xendit-secret" } });
    try {
      const token = (
        await app.inject({ method: "GET", url: "/api/session", headers: host })
      ).json() as { token: string };
      const headers = { ...host, "x-bayarlab-session": token.token };
      const providers = (
        await app.inject({ method: "GET", url: "/api/providers", headers: host })
      ).json() as { scenarios: Array<{ provider: string; id: string }> };
      expect(providers.scenarios).toContainEqual(
        expect.objectContaining({ provider: "xendit", id: "capture" }),
      );
      const payload = {
        provider: "xendit",
        scenario: "capture",
        target: "http://127.0.0.1:3000/webhook",
      };
      const preview = await app.inject({ method: "POST", url: "/api/preview", headers, payload });
      expect(preview.statusCode).toBe(200);
      expect(preview.body).toContain("[REDACTED]");
      expect(preview.body).not.toContain("dashboard-xendit-secret");
      expect(preview.body).toContain("payment.capture");
      const invalid = await app.inject({
        method: "POST",
        url: "/api/preview",
        headers,
        payload: { ...payload, invalidSignature: true },
      });
      expect(invalid.statusCode).toBe(200);
      expect(invalid.body).not.toContain("dashboard-xendit-secret");
    } finally {
      await app.close();
    }
  });

  it("offers DOKU non-SNAP Mandiri VA with redacted signature and query rejection", async () => {
    const app = createDashboardServer({
      config: { dokuClientId: "MCH-TEST-DOKU", dokuSecret: "dashboard-doku-secret" },
    });
    try {
      const token = (
        await app.inject({ method: "GET", url: "/api/session", headers: host })
      ).json() as { token: string };
      const headers = { ...host, "x-bayarlab-session": token.token };
      const providers = (
        await app.inject({ method: "GET", url: "/api/providers", headers: host })
      ).json() as { scenarios: Array<{ provider: string; id: string }> };
      expect(providers.scenarios).toContainEqual(
        expect.objectContaining({ provider: "doku", id: "success" }),
      );
      const payload = {
        provider: "doku",
        scenario: "success",
        target: "http://127.0.0.1:3000/webhook/doku",
      };
      const preview = await app.inject({ method: "POST", url: "/api/preview", headers, payload });
      expect(preview.statusCode).toBe(200);
      expect(preview.body).not.toContain("HMACSHA256=");
      expect(preview.body).toContain("[REDACTED]");
      expect(preview.body).not.toContain("dashboard-doku-secret");
      const query = await app.inject({
        method: "POST",
        url: "/api/preview",
        headers,
        payload: { ...payload, target: `${payload.target}?x=1` },
      });
      expect(query.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});
