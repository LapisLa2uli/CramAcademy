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

  if (typeof window !== "undefined" && window.location.protocol === "https:" && baseUrl.trim().toLowerCase().startsWith("http:")) {
    return (
      "Cannot reach Ollama: pages served over HTTPS cannot call http:// URLs (browser mixed-content blocking). " +
      "Run the app locally at http://localhost:3000 for AI extract with local Ollama, " +
      "or terminate HTTPS to your machine with a tunnel/proxy that exposes Ollama over HTTPS. " +
      "See README and docs/nginx-ollama-proxy.conf."
    );
  }

  return (
    `Failed to reach Ollama at ${baseUrl}. ` +
    "Ensure Ollama is running (`ollama serve`), NEXT_PUBLIC_OLLAMA_BASE_URL matches (e.g. http://127.0.0.1:11434), " +
    "and CORS allows this origin. If you use http://localhost:3000 but Ollama is on 127.0.0.1, configure Ollama or nginx CORS for http://localhost:3000."
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
