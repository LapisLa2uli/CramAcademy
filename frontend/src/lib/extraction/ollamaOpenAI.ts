/**
 * Minimal OpenAI-compatible chat client for browser → local Ollama.
 */

/** True when the deployed HTTPS app cannot call http:// Ollama (browser mixed-content policy). */
export function localOllamaBlockedFromHttpsPage(baseUrl: string): boolean {
  if (typeof window === "undefined") return false;
  const b = baseUrl.trim().toLowerCase();
  return window.location.protocol === "https:" && b.startsWith("http:");
}

function formatOllamaFetchError(e: unknown, baseUrl: string): string {
  const msg = e instanceof Error ? e.message : String(e);
  const isFailedFetch =
    msg === "Failed to fetch" || msg.includes("NetworkError") || msg.includes("Load failed");
  if (!isFailedFetch) return msg;

  const b = baseUrl.trim().toLowerCase();

  if (typeof window !== "undefined" && window.location.protocol === "https:" && b.startsWith("http:")) {
    return (
      "Cannot reach Ollama: pages served over HTTPS cannot call http:// URLs (browser mixed-content blocking). " +
      "Set NEXT_PUBLIC_OLLAMA_BASE_URL to https://127.0.0.1:8443 (and run `npm run ollama-https-proxy` locally), " +
      "or use http://localhost:3000 for dev. See README and scripts/ollama-https-proxy.mjs."
    );
  }

  if (b.startsWith("https://127.0.0.1") || b.startsWith("https://localhost")) {
    return (
      `Failed to reach Ollama at ${baseUrl}. ` +
      "Start the HTTPS proxy (`cd frontend && npm run ollama-https-proxy`), ensure `ollama serve` is running, " +
      "and if the browser blocked the connection due to a self-signed certificate, open that URL in a new tab once and proceed (or use mkcert). " +
      "If the app is on a different origin (e.g. another Vercel URL or port), set `OLLAMA_PROXY_ALLOWED_ORIGINS` when starting the proxy (comma-separated, exact `Origin` values). " +
      "Direct HTTP Ollama without the proxy: set NEXT_PUBLIC_OLLAMA_BASE_URL=http://127.0.0.1:11434 and use http://localhost:3000."
    );
  }

  return (
    `Failed to reach Ollama at ${baseUrl}. ` +
    "Ensure Ollama is running (`ollama serve`), NEXT_PUBLIC_OLLAMA_BASE_URL matches your setup, " +
    "and CORS allows this origin when using a custom proxy."
  );
}

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content:
    | string
    | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail?: string } }>;
};

/** When no parent `signal` is passed, default wall clock per request (local vision can be slow). Override via `NEXT_PUBLIC_OLLAMA_CHAT_TIMEOUT_MS`. */
const DEFAULT_CHAT_TIMEOUT_NO_PARENT_MS = 30 * 60 * 1000;

function envChatTimeoutMs(): number {
  if (typeof process === "undefined") return DEFAULT_CHAT_TIMEOUT_NO_PARENT_MS;
  const v = process.env.NEXT_PUBLIC_OLLAMA_CHAT_TIMEOUT_MS?.trim();
  if (!v) return DEFAULT_CHAT_TIMEOUT_NO_PARENT_MS;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CHAT_TIMEOUT_NO_PARENT_MS;
}

/**
 * Parent `signal` (e.g. full-job budget from `api.extraction.analyze`) must not be combined with a
 * short default per-call timeout — that used to abort every vision request at 180s while Ollama
 * was still working.
 */
function formatOllamaHttpError(status: number, bodyText: string): string {
  const snippet = bodyText.slice(0, 400);
  if (status === 403) {
    return (
      `Ollama HTTPS proxy returned 403: ${snippet.trim() || "Forbidden"}. ` +
      "The proxy only allows requests from known page origins. Add yours: stop the proxy, then restart with " +
      "`OLLAMA_PROXY_ALLOWED_ORIGINS=https://your-exact-origin` (comma-separated for multiple). " +
      "Example: `OLLAMA_PROXY_ALLOWED_ORIGINS=https://my-app.vercel.app npm run ollama-https-proxy` from `frontend/`."
    );
  }
  if (status !== 500) {
    return `Ollama chat failed (${status}): ${snippet}`;
  }
  let msg = snippet;
  try {
    const j = JSON.parse(bodyText) as { error?: { message?: string } };
    const m = j?.error?.message;
    if (typeof m === "string" && m.length) msg = m;
  } catch {
    /* keep snippet */
  }
  const lower = msg.toLowerCase();
  const runnerHint =
    lower.includes("model runner") ||
    lower.includes("runner has unexpectedly") ||
    lower.includes("resource limitation");
  if (runnerHint) {
    return (
      `Ollama chat failed (${status}): ${msg.slice(0, 300)} ` +
      "— Often VRAM/OOM or too much parallel load. Try NEXT_PUBLIC_OLLAMA_PAGE_CONCURRENCY=1, " +
      "smaller NEXT_PUBLIC_OLLAMA_MAX_EDGE / RASTER_DPI, set OLLAMA_NUM_PARALLEL=1 where Ollama runs, " +
      "and check `ollama` server logs."
    );
  }
  return `Ollama chat failed (${status}): ${msg.slice(0, 400)}`;
}

function resolveChatAbortSignal(params: {
  signal?: AbortSignal;
  timeoutMs?: number;
}): AbortSignal | undefined {
  const hasTimeout = typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function";
  const hasAny = typeof AbortSignal !== "undefined" && "any" in AbortSignal;

  if (params.signal) {
    if (params.timeoutMs != null && hasTimeout && hasAny) {
      return AbortSignal.any([params.signal, AbortSignal.timeout(params.timeoutMs)]);
    }
    return params.signal;
  }

  const ms = params.timeoutMs ?? envChatTimeoutMs();
  if (hasTimeout) return AbortSignal.timeout(ms);
  return undefined;
}

function parseSseDeltaContent(line: string): string | null {
  const t = line.trim();
  if (!t.startsWith("data:")) return null;
  const payload = t.slice(5).trim();
  if (payload === "[DONE]") return null;
  try {
    const j = JSON.parse(payload) as {
      choices?: Array<{ delta?: { content?: string | null } }>;
    };
    const c = j.choices?.[0]?.delta?.content;
    return typeof c === "string" && c.length ? c : null;
  } catch {
    return null;
  }
}

/**
 * OpenAI-compatible SSE stream; aggregates assistant text into a single string.
 * Invokes `onFirstToken` when the first content delta arrives.
 */
async function readChatCompletionStream(
  body: ReadableStream<Uint8Array> | null,
  onFirstToken?: () => void
): Promise<string | null> {
  if (!body) return null;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let sawFirst = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const piece = parseSseDeltaContent(line);
        if (piece) {
          if (!sawFirst) {
            sawFirst = true;
            onFirstToken?.();
          }
          content += piece;
        }
      }
    }
    if (buffer.trim()) {
      const piece = parseSseDeltaContent(buffer);
      if (piece) {
        if (!sawFirst) {
          sawFirst = true;
          onFirstToken?.();
        }
        content += piece;
      }
    }
  } finally {
    reader.releaseLock();
  }
  return content.length ? content : null;
}

export async function ollamaChatCompletion(params: {
  baseUrl: string;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  responseFormat?: { type: string; json_schema?: unknown };
  signal?: AbortSignal;
  /** Optional cap when `signal` is also set (both can abort the request). */
  timeoutMs?: number;
  /** When true, read SSE and aggregate content; enables `onFirstToken` for debug UI. */
  stream?: boolean;
  /** First streamed text delta (approximate start of visible generation). */
  onFirstToken?: () => void;
}): Promise<{ content: string | null }> {
  const url = `${params.baseUrl.replace(/\/$/, "")}/v1/chat/completions`;
  const useStream = params.stream === true;
  const body: Record<string, unknown> = {
    model: params.model,
    messages: params.messages,
    temperature: params.temperature ?? 0.1,
    stream: useStream,
  };
  if (params.responseFormat) {
    body.response_format = params.responseFormat;
  }

  const signal = resolveChatAbortSignal({
    signal: params.signal,
    timeoutMs: params.timeoutMs,
  });

  let res: Response;
  try {
    const init: RequestInit = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    };
    if (signal) init.signal = signal;
    res = await fetch(url, init);
  } catch (e) {
    throw new Error(formatOllamaFetchError(e, params.baseUrl));
  }

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(formatOllamaHttpError(res.status, text));
  }

  if (useStream) {
    const content = await readChatCompletionStream(res.body, params.onFirstToken);
    return { content };
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const content = data.choices?.[0]?.message?.content ?? null;
  return { content };
}
