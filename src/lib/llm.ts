import { PROVIDERS, providerById, type ProviderId } from "./providers";
import { httpFetch } from "./http";
import { isOllamaProvider, streamOllamaChat } from "./ollama";
import { DEFAULT_SETTINGS, normalizeFlow, normalizeTypeScale, type ChatMessage, type Settings } from "./types";

export type { ChatMessage, Settings };
export { DEFAULT_SETTINGS, normalizeFlow, normalizeTypeScale };

function writerSystem(extra?: string) {
  return (
    extra ??
    "You are CopyWritePrime, a writing instrument sitting in the sentence with a fast, messy typer. Match their voice. Be concrete. Never announce that you are an AI. Return only the requested prose."
  );
}

async function readSse(
  body: ReadableStream<Uint8Array> | null,
  pick: (json: Record<string, unknown>) => string | undefined,
  onDelta: (chunk: string) => void,
): Promise<string> {
  if (!body) throw new Error("Empty response body");
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        const json = JSON.parse(data) as Record<string, unknown>;
        const piece = pick(json);
        if (piece) {
          full += piece;
          onDelta(piece);
        }
      } catch {
        /* keep scanning */
      }
    }
  }
  return full;
}

function openaiDelta(json: Record<string, unknown>) {
  const choices = json.choices as Array<{ delta?: { content?: string } }> | undefined;
  return choices?.[0]?.delta?.content;
}

function anthropicDelta(json: Record<string, unknown>) {
  if (json.type === "content_block_delta") {
    const delta = json.delta as { text?: string } | undefined;
    return delta?.text;
  }
  return undefined;
}

function geminiDelta(json: Record<string, unknown>) {
  const candidates = json.candidates as
    | Array<{ content?: { parts?: Array<{ text?: string }> } }>
    | undefined;
  return candidates?.[0]?.content?.parts?.[0]?.text;
}

function cohereDelta(json: Record<string, unknown>) {
  if (json.type === "content-delta") {
    const delta = json.delta as { message?: { content?: { text?: string } } } | undefined;
    return delta?.message?.content?.text;
  }
  return undefined;
}

export async function streamChat(opts: {
  settings: Settings;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  onDelta: (chunk: string) => void;
  signal?: AbortSignal;
}): Promise<string> {
  const provider = providerById(opts.settings.provider);
  const key = opts.settings.keys[provider.id] ?? "";
  if (!isOllamaProvider(provider.id) && provider.id !== "custom" && !key) {
    throw new Error(`Add a ${provider.name} key in Settings.`);
  }

  const base =
    provider.id === "custom" ? opts.settings.customBaseUrl.replace(/\/$/, "") : provider.baseUrl;
  const model = opts.settings.model || provider.models[0];
  const maxTokens = opts.maxTokens ?? 800;
  const temperature = opts.temperature ?? 0.6;

  if (provider.kind === "ollama") {
    return streamOllamaChat(opts);
  }

  if (provider.kind === "anthropic") {
    const system = opts.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const messages = opts.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role, content: m.content }));
    const res = await httpFetch(`${base}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature,
        system,
        messages,
        stream: true,
      }),
      signal: opts.signal,
    });
    if (!res.ok) throw new Error(await errorText(res));
    return readSse(res.body, anthropicDelta, opts.onDelta);
  }

  if (provider.kind === "google") {
    const contents = opts.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));
    const system = opts.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const url = `${base}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(key)}`;
    const res = await httpFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents,
        systemInstruction: system ? { parts: [{ text: system }] } : undefined,
        generationConfig: { temperature, maxOutputTokens: maxTokens },
      }),
      signal: opts.signal,
    });
    if (!res.ok) throw new Error(await errorText(res));
    return readSse(res.body, geminiDelta, opts.onDelta);
  }

  if (provider.kind === "cohere") {
    const system = opts.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const messages = opts.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));
    const res = await httpFetch(`${base}/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages: system
          ? [{ role: "system", content: system }, ...messages]
          : messages,
        stream: true,
        temperature,
      }),
      signal: opts.signal,
    });
    if (!res.ok) throw new Error(await errorText(res));
    return readSse(res.body, cohereDelta, opts.onDelta);
  }

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (key) headers.authorization = `Bearer ${key}`;
  if (provider.id === "openrouter") {
    headers["http-referer"] = "https://copywriteprime.app";
    headers["x-title"] = "CopyWritePrime";
  }

  const res = await httpFetch(`${base}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: opts.messages,
      stream: true,
      temperature,
      max_tokens: maxTokens,
    }),
    signal: opts.signal,
  });
  if (!res.ok) throw new Error(await errorText(res));
  return readSse(res.body, openaiDelta, opts.onDelta);
}

async function errorText(res: Response) {
  const body = await res.text();
  try {
    const json = JSON.parse(body) as { error?: { message?: string }; message?: string };
    return json.error?.message || json.message || `${res.status} ${body.slice(0, 240)}`;
  } catch {
    return `${res.status} ${body.slice(0, 240)}`;
  }
}

function cleanModelText(out: string) {
  return out
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/^```(?:\w+)?\n?|\n?```$/g, "")
    .trim();
}

export async function flowContinue(
  settings: Settings,
  preceding: string,
  onDelta: (c: string) => void,
  signal?: AbortSignal,
) {
  const trimmed = preceding.trim();
  if (trimmed.length < 8) return "";
  const tail = trimmed.slice(-1600);
  const enhance = settings.flow === "enhance";
  return streamChat({
    settings,
    maxTokens: enhance ? 110 : 70,
    temperature: 0.7,
    signal,
    messages: [
      {
        role: "system",
        content: writerSystem(
          enhance
            ? "You are in the sentence with the writer. They type fast and messy. Continue 15–40 words in their voice, slightly sharper and more concrete. Finish the thought they started. No quotes, no preamble, no restarting what they already wrote. If the thought is complete, return nothing."
            : "You are in the sentence with the writer. They type fast and messy. Continue 10–28 words in their exact voice as they meant it. Finish the fragment if it is unfinished. No quotes, no preamble, no restarting. If the thought is complete, return nothing.",
        ),
      },
      { role: "user", content: tail },
    ],
    onDelta,
  });
}

export async function polishSentence(settings: Settings, sentence: string, signal?: AbortSignal) {
  let out = "";
  await streamChat({
    settings,
    maxTokens: 160,
    temperature: 0.1,
    signal,
    messages: [
      {
        role: "system",
        content: writerSystem(
          "This writer types fast and messy. Fix spelling, grammar, missing words, and punctuation. Keep their voice, slang, and rhythm. Do not add ideas. Do not get fancier. If it is already correct, return exactly NOOP. Return only the corrected sentence or NOOP.",
        ),
      },
      { role: "user", content: sentence },
    ],
    onDelta: (c) => {
      out += c;
    },
  });
  const cleaned = cleanModelText(out);
  if (!cleaned || cleaned === "NOOP" || cleaned === sentence.trim()) return null;
  return cleaned;
}

export async function enhanceSentence(settings: Settings, sentence: string, signal?: AbortSignal) {
  let out = "";
  await streamChat({
    settings,
    maxTokens: 220,
    temperature: 0.35,
    signal,
    messages: [
      {
        role: "system",
        content: writerSystem(
          "This writer types fast and messy. First fix errors. Then make the line one notch clearer and more specific. Same person, same meaning. You may mark one or two punch words with **bold**. No extra sentences. No slogans. If it is already strong and clean, return exactly NOOP. Return only the line or NOOP.",
        ),
      },
      { role: "user", content: sentence },
    ],
    onDelta: (c) => {
      out += c;
    },
  });
  const cleaned = cleanModelText(out);
  if (!cleaned || cleaned === "NOOP" || cleaned === sentence.trim()) return null;
  return cleaned;
}

export async function transform(settings: Settings, instruction: string, source: string) {
  let out = "";
  await streamChat({
    settings,
    maxTokens: 1800,
    temperature: 0.55,
    messages: [
      {
        role: "system",
        content: writerSystem(
          "Rewrite or generate copy per the instruction. Return only the copy. You may use markdown: # ## ### headings, **bold**, *italic*. No commentary. No code fences.",
        ),
      },
      {
        role: "user",
        content: `Instruction:\n${instruction}\n\nSource:\n${source || "(empty — write from the instruction)"}`,
      },
    ],
    onDelta: (c) => {
      out += c;
    },
  });
  return cleanModelText(out);
}

export function hasKey(settings: Settings) {
  const p = settings.provider;
  if (p === "ollama" || p === "custom") return true;
  return Boolean(settings.keys[p]);
}

export function defaultModelFor(provider: ProviderId) {
  return PROVIDERS.find((p) => p.id === provider)?.models[0] ?? "gpt-4o";
}
