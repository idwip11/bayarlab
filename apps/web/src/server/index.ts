import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { BayarLabError, type DeliveryResult, type WireRequest } from "@bayarlab/core";
import { deliver, prepareSignedRequest, toDisplayResult } from "@bayarlab/engine";
import { corruptDokuNonSnapSignature, dokuAdapter } from "@bayarlab/provider-doku";
import { corruptMidtransSignature, midtransAdapter } from "@bayarlab/provider-midtrans";
import { corruptXenditCallbackToken, xenditAdapter } from "@bayarlab/provider-xendit";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";

const MAX_HISTORY = 100;
const mimeTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

interface DashboardConfig {
  amount: number;
  timeoutMs: number;
  secret: string;
  xenditToken: string;
  dokuClientId: string;
  dokuSecret: string;
}

interface SendBody {
  provider: string;
  scenario: string;
  target: string;
  amount?: number;
  orderId?: string;
  invalidSignature?: boolean;
  allowRemoteTarget?: boolean;
}

interface DashboardRecord {
  id: string;
  provider: string;
  scenario: string;
  request: WireRequest;
  result: DeliveryResult;
  allowRemoteTarget: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function parseSendBody(value: unknown): SendBody {
  const body = asRecord(value);
  if (
    !body ||
    typeof body.provider !== "string" ||
    typeof body.scenario !== "string" ||
    typeof body.target !== "string"
  ) {
    throw new BayarLabError("INVALID_REQUEST", "Provider, scenario, and target are required.");
  }
  if (
    body.amount !== undefined &&
    (typeof body.amount !== "number" || !Number.isSafeInteger(body.amount))
  ) {
    throw new BayarLabError("INVALID_REQUEST", "Amount must be a whole IDR value.");
  }
  if (body.orderId !== undefined && typeof body.orderId !== "string") {
    throw new BayarLabError("INVALID_REQUEST", "Order ID must be a string.");
  }
  return {
    provider: body.provider,
    scenario: body.scenario,
    target: body.target,
    ...(body.amount === undefined ? {} : { amount: body.amount }),
    ...(body.orderId === undefined ? {} : { orderId: body.orderId }),
    ...(body.invalidSignature === true ? { invalidSignature: true } : {}),
    ...(body.allowRemoteTarget === true ? { allowRemoteTarget: true } : {}),
  };
}

function errorResponse(error: unknown): {
  status: number;
  body: { code: string; message: string };
} {
  if (error instanceof BayarLabError)
    return { status: 400, body: { code: error.code, message: error.message } };
  return { status: 500, body: { code: "UNKNOWN", message: "Dashboard operation failed." } };
}

function permittedHost(host: string | undefined): boolean {
  const hostname = (host ?? "").split(":")[0]?.toLowerCase();
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
}

function requestOriginAllowed(request: FastifyRequest): boolean {
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  const host = request.headers.host;
  return typeof origin === "string" && host !== undefined && origin === `http://${host}`;
}

function curlTemplate(request: WireRequest, secrets: readonly string[]): string {
  const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
  const safe = toDisplayResult(
    { requestId: "curl", targetUrl: request.targetUrl, request, durationMs: 0 },
    secrets,
  );
  const headers = Object.entries(safe.request.headers)
    .map(([name, value]) => ` -H ${quote(`${name}: ${value}`)}`)
    .join("");
  return `curl -X POST ${quote(safe.targetUrl)}${headers} --data ${quote(safe.request.body)}`;
}

export interface DashboardOptions {
  config?: Partial<DashboardConfig>;
  staticRoot?: string;
}

export function createDashboardServer(options: DashboardOptions = {}): FastifyInstance {
  const config: DashboardConfig = {
    amount: options.config?.amount ?? 150_000,
    timeoutMs: options.config?.timeoutMs ?? 15_000,
    secret:
      options.config?.secret ?? process.env.BAYARLAB_MIDTRANS_TEST_KEY ?? "bayarlab-local-test-key",
    xenditToken:
      options.config?.xenditToken ??
      process.env.BAYARLAB_XENDIT_CALLBACK_TOKEN ??
      "bayarlab-local-xendit-token",
    dokuClientId:
      options.config?.dokuClientId ?? process.env.BAYARLAB_DOKU_CLIENT_ID ?? "MCH-BAYARLAB-LOCAL",
    dokuSecret:
      options.config?.dokuSecret ??
      process.env.BAYARLAB_DOKU_SECRET ??
      "bayarlab-local-doku-secret",
  };
  const token = randomBytes(32).toString("base64url");
  const history: DashboardRecord[] = [];
  const staticRoot = options.staticRoot ?? fileURLToPath(new URL("./client/", import.meta.url));
  const app = Fastify({ logger: false });

  function append(record: DashboardRecord): void {
    history.push(record);
    if (history.length > MAX_HISTORY) history.shift();
  }

  function display(record: DashboardRecord) {
    return {
      id: record.id,
      provider: record.provider,
      scenario: record.scenario,
      result: toDisplayResult(record.result, [
        config.secret,
        config.xenditToken,
        config.dokuSecret,
      ]),
      curl: curlTemplate(record.request, [config.secret, config.xenditToken, config.dokuSecret]),
    };
  }

  async function buildRequest(body: SendBody): Promise<WireRequest> {
    if (body.provider !== "midtrans" && body.provider !== "xendit" && body.provider !== "doku")
      throw new BayarLabError("INVALID_REQUEST", `Unsupported provider: ${body.provider}`);
    const adapter =
      body.provider === "doku"
        ? dokuAdapter
        : body.provider === "xendit"
          ? xenditAdapter
          : midtransAdapter;
    const secret =
      body.provider === "doku"
        ? config.dokuSecret
        : body.provider === "xendit"
          ? config.xenditToken
          : config.secret;
    const definition = adapter.listScenarios().find((item) => item.id === body.scenario);
    if (!definition)
      throw new BayarLabError(
        "INVALID_REQUEST",
        `Unsupported ${body.provider} scenario: ${body.scenario}`,
      );
    const event = await adapter.buildEvent({
      scenario: body.scenario,
      product: definition.product,
      amount: body.amount ?? config.amount,
      ...(body.orderId === undefined ? {} : { orderId: body.orderId }),
    });
    const signed = await prepareSignedRequest(adapter, event, body.target, {
      secret,
      ...(body.provider === "doku" ? { clientId: config.dokuClientId } : {}),
    });
    return body.invalidSignature === true
      ? body.provider === "doku"
        ? corruptDokuNonSnapSignature(signed)
        : body.provider === "xendit"
          ? corruptXenditCallbackToken(signed)
          : corruptMidtransSignature(signed)
      : signed;
  }

  app.addHook("onRequest", async (request, reply) => {
    if (!permittedHost(request.headers.host) || !requestOriginAllowed(request)) {
      await reply
        .code(403)
        .send({ code: "DASHBOARD_ORIGIN_DENIED", message: "Local dashboard requests only." });
    }
  });

  app.get("/api/session", async () => ({ token }));
  app.get("/api/providers", async () => ({
    providers: [midtransAdapter.manifest, xenditAdapter.manifest, dokuAdapter.manifest],
    scenarios: [
      ...midtransAdapter.listScenarios().map((item) => ({ ...item, provider: "midtrans" })),
      ...xenditAdapter.listScenarios().map((item) => ({ ...item, provider: "xendit" })),
      ...dokuAdapter.listScenarios().map((item) => ({ ...item, provider: "doku" })),
    ],
  }));
  app.get("/api/history", async () => ({ records: history.map(display) }));

  app.post("/api/preview", async (request, reply) => {
    if (request.headers["x-bayarlab-session"] !== token)
      return reply.code(403).send({ code: "DASHBOARD_SESSION_DENIED" });
    try {
      const wireRequest = await buildRequest(parseSendBody(request.body));
      return {
        request: toDisplayResult(
          {
            requestId: "preview",
            targetUrl: wireRequest.targetUrl,
            request: wireRequest,
            durationMs: 0,
          },
          [config.secret, config.xenditToken, config.dokuSecret],
        ).request,
        curl: curlTemplate(wireRequest, [config.secret, config.xenditToken, config.dokuSecret]),
      };
    } catch (error) {
      const safe = errorResponse(error);
      return reply.code(safe.status).send(safe.body);
    }
  });

  app.post("/api/send", async (request, reply) => {
    if (request.headers["x-bayarlab-session"] !== token)
      return reply.code(403).send({ code: "DASHBOARD_SESSION_DENIED" });
    try {
      const body = parseSendBody(request.body);
      const wireRequest = await buildRequest(body);
      const result = await deliver(wireRequest, {
        timeoutMs: config.timeoutMs,
        allowRemoteTarget: body.allowRemoteTarget === true,
      });
      const record = {
        id: result.requestId,
        provider: body.provider,
        scenario: body.scenario,
        request: wireRequest,
        result,
        allowRemoteTarget: body.allowRemoteTarget === true,
      };
      append(record);
      return display(record);
    } catch (error) {
      const safe = errorResponse(error);
      return reply.code(safe.status).send(safe.body);
    }
  });

  app.post("/api/replay/:id", async (request, reply) => {
    if (request.headers["x-bayarlab-session"] !== token)
      return reply.code(403).send({ code: "DASHBOARD_SESSION_DENIED" });
    const source = history.find((record) => record.id === (request.params as { id?: string }).id);
    if (!source)
      return reply.code(404).send({ code: "NOT_FOUND", message: "History record not found." });
    try {
      const result = await deliver(source.request, {
        timeoutMs: config.timeoutMs,
        allowRemoteTarget: source.allowRemoteTarget,
      });
      const record = { ...source, id: result.requestId, result };
      append(record);
      return display(record);
    } catch (error) {
      const safe = errorResponse(error);
      return reply.code(safe.status).send(safe.body);
    }
  });

  app.get("/*", async (request, reply) => {
    const pathname = request.url.split("?")[0] ?? "/";
    const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    if (relative.includes("..")) return reply.code(404).send();
    try {
      const filename = resolve(staticRoot, relative);
      if (!filename.startsWith(resolve(staticRoot))) return reply.code(404).send();
      const data = await readFile(filename);
      return reply.type(mimeTypes[extname(filename)] ?? "application/octet-stream").send(data);
    } catch {
      if (!extname(relative)) {
        const data = await readFile(resolve(staticRoot, "index.html"));
        return reply.type(mimeTypes[".html"] ?? "text/html; charset=utf-8").send(data);
      }
      return reply.code(404).send();
    }
  });

  return app;
}

export async function startDashboard(port = 8787): Promise<{ app: FastifyInstance; url: string }> {
  const app = createDashboardServer();
  await app.listen({ host: "127.0.0.1", port });
  return { app, url: `http://127.0.0.1:${port}` };
}
