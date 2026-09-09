import { httpFetch } from "./http";
import { OLLAMA_CLOUD_MODELS, OLLAMA_LOCAL_MODELS } from "./ollamaCatalog";
import { consumeNdjson } from "./sse";
import { ollamaBudget, ollamaThink } from "./ollamaThink";
import { readStream, type StreamHandlers, type StreamResult } from "./stream";
import type { ChatMessage, Settings } from "./types";
import type { ProviderId } from "./providers";

export { ollamaBudget, ollamaThink };

export function isOllamaProvider(id: ProviderId) {
  return id === "ollama" || id === "ollama-cloud";
}

export function ollamaBase(settings: Settings, id: ProviderId = settings.provider) {
  if (id === "ollama-cloud") return "https://ollama.com";
  return (settings.ollamaLocalHost || "http://127.0.0.1:11434").replace(/\/$/, "");
}

export function ollamaAuth(settings: Settings, id: ProviderId = settings.provider) {
  if (id === "ollama-cloud") return settings.keys["ollama-cloud"] ?? "";
  return settings.keys.ollama ?? "";
}

async function errorText(res: Response) {
  const body = await res.text();
  try {
    const json = JSON.parse(body) as { error?: string; message?: string };
    return json.error || json.message || `${res.status} ${body.slice(0, 240)}`;
  } catch {
    return `${res.status} ${body.slice(0, 240)}`;
  }
}

export async function listOllamaModels(settings: Settings, id: ProviderId): Promise<string[]> {
  const baked = id === "ollama-cloud" ? [...OLLAMA_CLOUD_MODELS] : [...OLLAMA_LOCAL_MODELS];
  try {
    const base = ollamaBase(settings, id);
    const key = ollamaAuth(settings, id);
    const headers: Record<string, string> = { accept: "application/json" };
    if (key) headers.authorization = `Bearer ${key}`;
    const res = await httpFetch(`${base}/api/tags`, { method: "GET", headers });
    if (!res.ok) throw new Error(await errorText(res));
    const json = (await res.json()) as { models?: Array<{ name?: string; model?: string }> };
    const live = (json.models ?? []).map((m) => m.name || m.model || "").filter(Boolean);
    const bakedSet = new Set<string>(baked);
    const extras = live.filter((name) => !bakedSet.has(name));
    return [...new Set([...extras, ...baked, ...live])];
  } catch (e) {
    if (id === "ollama-cloud") return baked;
    throw e;
  }
}

export async function streamOllamaChat(opts: {
  settings: Settings;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  handlers: StreamHandlers;
}): Promise<StreamResult> {
  const id = opts.settings.provider;
  const base = ollamaBase(opts.settings, id);
  const key = ollamaAuth(opts.settings, id);
  if (id === "ollama-cloud" && !key) {
    throw new Error("Add an Ollama Cloud key from ollama.com/settings/keys.");
  }
  const model = opts.settings.model;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (key) headers.authorization = `Bearer ${key}`;
  const think = ollamaThink(model, opts.settings.reasoning);

  const res = await httpFetch(`${base}/api/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: opts.messages,
      stream: true,
      think,
      options: {
        temperature: opts.temperature ?? 0.6,
        num_predict: ollamaBudget(opts.maxTokens ?? 800, think),
      },
    }),
    signal: opts.signal,
  });
  if (!res.ok) throw new Error(await errorText(res));
  return readStream(res.body, consumeNdjson, opts.handlers);
}
