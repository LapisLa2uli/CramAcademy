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

export async function ollamaChatCompletion(params: {
  baseUrl: string;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  responseFormat?: { type: string; json_schema?: unknown };
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<{ content: string | null }> {
  const url = `${params.baseUrl.replace(/\/$/, "")}/v1/chat/completions`;
  const body: Record<string, unknown> = {
    model: params.model,
    messages: params.messages,
    temperature: params.temperature ?? 0.1,
    stream: false,
  };
  if (params.responseFormat) {
    body.response_format = params.responseFormat;
  }

  const t = params.timeoutMs ?? 180_000;
  const timeoutSig =
    typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
      ? AbortSignal.timeout(t)
      : undefined;
  let signal = params.signal ?? timeoutSig;
  if (params.signal && timeoutSig && typeof AbortSignal !== "undefined" && "any" in AbortSignal) {
    signal = AbortSignal.any([params.signal, timeoutSig]);
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    throw new Error(formatOllamaFetchError(e, params.baseUrl));
  }

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Ollama chat failed (${res.status}): ${text.slice(0, 500)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const content = data.choices?.[0]?.message?.content ?? null;
  return { content };
}
