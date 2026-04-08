/**
 * Minimal OpenAI-compatible chat client for browser → local Ollama.
 */

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

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

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
