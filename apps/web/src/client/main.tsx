import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

import "./styles.css";

type Scenario = { id: string; label: string; product: string; state: string; provider: string };
type DisplayResult = {
  requestId: string;
  targetUrl: string;
  request: { method: string; headers: Record<string, string>; body: string };
  response?: { status: number; headers: Record<string, string>; body: string; truncated: boolean };
  durationMs: number;
  error?: { code: string; message: string };
};
type RecordItem = {
  id: string;
  provider: string;
  scenario: string;
  result: DisplayResult;
  curl: string;
};
type Preview = { request: DisplayResult["request"]; curl: string };

const initialTarget = "http://127.0.0.1:3000/webhook";

function isRemote(target: string): boolean {
  try {
    const hostname = new URL(target).hostname;
    return !["localhost", "127.0.0.1", "::1"].includes(hostname);
  } catch {
    return false;
  }
}

function App() {
  const [token, setToken] = useState("");
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [provider, setProvider] = useState("midtrans");
  const [scenario, setScenario] = useState("settlement");
  const [target, setTarget] = useState(initialTarget);
  const [amount, setAmount] = useState("150000");
  const [orderId, setOrderId] = useState("");
  const [invalidSignature, setInvalidSignature] = useState(false);
  const [allowRemoteTarget, setAllowRemoteTarget] = useState(false);
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [selected, setSelected] = useState<RecordItem>();
  const [preview, setPreview] = useState<Preview>();
  const [tab, setTab] = useState<"request" | "response" | "curl">("request");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/session").then((response) => response.json()),
      fetch("/api/providers").then((response) => response.json()),
      fetch("/api/history").then((response) => response.json()),
    ])
      .then(([session, providers, history]) => {
        setToken(session.token);
        setScenarios(providers.scenarios);
        setRecords(history.records);
        setSelected(history.records.at(-1));
      })
      .catch(() => setError("Dashboard API is unavailable."));
  }, []);

  const body = useMemo(
    () => ({
      provider,
      scenario,
      target,
      amount: Number(amount),
      ...(orderId.trim() === "" ? {} : { orderId: orderId.trim() }),
      invalidSignature,
      allowRemoteTarget,
    }),
    [allowRemoteTarget, amount, invalidSignature, orderId, provider, scenario, target],
  );

  const visibleScenarios = scenarios.filter((item) => item.provider === provider);

  function selectProvider(next: string): void {
    setProvider(next);
    setScenario(next === "doku" ? "success" : next === "xendit" ? "capture" : "settlement");
    setPreview(undefined);
    setError("");
  }

  async function api<T>(path: string, requestBody?: unknown): Promise<T> {
    const response = await fetch(path, {
      method: requestBody === undefined ? "GET" : "POST",
      headers:
        requestBody === undefined
          ? {}
          : { "content-type": "application/json", "x-bayarlab-session": token },
      ...(requestBody === undefined ? {} : { body: JSON.stringify(requestBody) }),
    });
    const json = (await response.json()) as T & { message?: string };
    if (!response.ok) throw new Error(json.message ?? "Dashboard request failed.");
    return json;
  }

  async function refreshHistory(): Promise<void> {
    const history = await api<{ records: RecordItem[] }>("/api/history");
    setRecords(history.records);
  }

  async function previewRequest(): Promise<void> {
    setWorking(true);
    setError("");
    try {
      setPreview(await api<Preview>("/api/preview", body));
      setTab("request");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not build preview.");
    } finally {
      setWorking(false);
    }
  }

  async function send(): Promise<void> {
    if (isRemote(target) && !allowRemoteTarget) {
      setError("Public or production-like targets require explicit confirmation.");
      return;
    }
    setWorking(true);
    setError("");
    try {
      const result = await api<RecordItem>("/api/send", body);
      setSelected(result);
      setPreview(undefined);
      setTab("response");
      await refreshHistory();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Delivery failed.");
    } finally {
      setWorking(false);
    }
  }

  async function replay(id: string): Promise<void> {
    setWorking(true);
    setError("");
    try {
      const result = await api<RecordItem>(`/api/replay/${encodeURIComponent(id)}`, {});
      setSelected(result);
      setTab("response");
      await refreshHistory();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Replay failed.");
    } finally {
      setWorking(false);
    }
  }

  const requestBody =
    selected?.result.request.body ??
    preview?.request.body ??
    "Select Preview or Send to inspect a payload.";
  const responseBody = selected?.result.error
    ? `${selected.result.error.code}: ${selected.result.error.message}`
    : (selected?.result.response?.body ?? "No response yet.");
  const curl = selected?.curl ?? preview?.curl ?? "No cURL template yet.";

  return (
    <main>
      <header>
        <div>
          <strong>BayarLab</strong>
          <span>Local-first webhook simulator</span>
        </div>
        <small>● Local only</small>
      </header>
      <section className="layout">
        <aside>
          <h2>Provider</h2>
          <button
            className={provider === "midtrans" ? "selected" : ""}
            type="button"
            onClick={() => selectProvider("midtrans")}
          >
            Midtrans <small>Classic Core API</small>
          </button>
          <button
            className={provider === "xendit" ? "selected" : ""}
            type="button"
            onClick={() => selectProvider("xendit")}
          >
            Xendit <small>Payments API v3 · ID DANA</small>
          </button>
          <button
            className={provider === "doku" ? "selected" : ""}
            type="button"
            onClick={() => selectProvider("doku")}
          >
            DOKU <small>Direct API · non-SNAP Mandiri VA</small>
          </button>
          <p>
            {provider === "doku"
              ? "Mandiri VA successful-payment notification."
              : provider === "xendit"
                ? "DANA capture and composed failure webhook presets."
                : "Six BNI VA and card notification presets."}
          </p>
          <h2>Session history</h2>
          <ol>
            {records.length === 0 && <li className="muted">No deliveries yet.</li>}
            {records.map((record) => (
              <li key={record.id}>
                <button type="button" onClick={() => setSelected(record)}>
                  <span>
                    {record.provider} · {record.scenario}
                  </span>
                  <small>
                    {record.result.error
                      ? "error"
                      : `HTTP ${record.result.response?.status ?? "—"}`}
                  </small>
                </button>
              </li>
            ))}
          </ol>
        </aside>
        <section className="workspace">
          <div className="panel scenario-panel">
            <div className="panel-heading">
              <h1>Compose webhook</h1>
              <span>Provider-compatible synthetic event</span>
            </div>
            <label>
              Event
              <select value={scenario} onChange={(event) => setScenario(event.target.value)}>
                {visibleScenarios.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label} · {item.state}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Target URL
              <input
                value={target}
                onChange={(event) => setTarget(event.target.value)}
                inputMode="url"
              />
            </label>
            <div className="two-columns">
              <label>
                Amount (IDR)
                <input
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  inputMode="numeric"
                />
              </label>
              <label>
                Order ID <small>(auto if blank)</small>
                <input value={orderId} onChange={(event) => setOrderId(event.target.value)} />
              </label>
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={invalidSignature}
                onChange={(event) => setInvalidSignature(event.target.checked)}
              />{" "}
              {provider === "xendit" ? "Corrupt callback token" : "Corrupt signature after signing"}
            </label>
            {isRemote(target) && (
              <label className="check warning">
                <input
                  type="checkbox"
                  checked={allowRemoteTarget}
                  onChange={(event) => setAllowRemoteTarget(event.target.checked)}
                />{" "}
                I understand this is a public or production-like target
              </label>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="actions">
              <button
                type="button"
                className="secondary"
                onClick={() => void previewRequest()}
                disabled={working || token === ""}
              >
                Preview
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => void send()}
                disabled={working || token === ""}
              >
                {working ? "Working…" : "Send webhook"}
              </button>
            </div>
          </div>
          <div className="panel inspector">
            <div className="panel-heading">
              <h2>Inspector</h2>
              {selected && <span>{selected.result.durationMs} ms</span>}
            </div>
            <nav>
              <button
                type="button"
                className={tab === "request" ? "active" : ""}
                onClick={() => setTab("request")}
              >
                Request
              </button>
              <button
                type="button"
                className={tab === "response" ? "active" : ""}
                onClick={() => setTab("response")}
              >
                Response
              </button>
              <button
                type="button"
                className={tab === "curl" ? "active" : ""}
                onClick={() => setTab("curl")}
              >
                cURL
              </button>
            </nav>
            {tab === "request" && <pre>{requestBody}</pre>}
            {tab === "response" && <pre>{responseBody}</pre>}
            {tab === "curl" && <pre>{curl}</pre>}
            {selected && (
              <button
                type="button"
                className="secondary replay"
                onClick={() => void replay(selected.id)}
                disabled={working}
              >
                Replay original bytes
              </button>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("BayarLab root element is missing.");
createRoot(root).render(<App />);
