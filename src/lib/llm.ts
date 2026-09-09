import { killEmDashes } from "./dashes";
import { PROVIDERS, providerById, type ProviderId } from "./providers";
import { httpFetch } from "./http";
import { isOllamaProvider, streamOllamaChat } from "./ollama";
import { anthropicDelta, consumeSse, cohereDelta, geminiDelta, openaiDelta } from "./sse";
import { DEFAULT_SETTINGS, normalizeFlow, normalizeTypeScale, type ChatMessage, type Settings } from "./types";
import { excerptCorpus } from "./voice";

export type { ChatMessage, Settings };
export { DEFAULT_SETTINGS, normalizeFlow, normalizeTypeScale };

function writerSystem(extra?: string) {
  const ban =
    " Never use an em dash, a horizontal bar, or -- as a pause. Write a period, a comma, a colon, or a new sentence. Number ranges like 10–15 may keep an en dash.";
  return (
    (extra ??
      "You are CopyWritePrime, a writing instrument sitting in the sentence with a fast, messy typer. Match their voice. Be concrete. Never announce that you are an AI. Return only the requested prose.") +
    ban
  );
}

function voiceNote(settings: Settings) {
  if (!settings.voiceEnabled || !settings.voice?.card?.trim()) return "";
  return `\n\nVOICE. This is how they write. Match it. Do not imitate poorly. Do not announce the voice.\n---\n${settings.voice.card.slice(0, 4000)}`;
}

function withVoice(settings: Settings, messages: ChatMessage[], skipVoice?: boolean): ChatMessage[] {
  const note = skipVoice ? "" : voiceNote(settings);
  if (!note) return messages;
  const first = messages[0];
  if (first?.role === "system") {
    return [{ ...first, content: first.content + note }, ...messages.slice(1)];
  }
  return [{ role: "system", content: `Match the writer's voice.${note}` }, ...messages];
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
  const eat = (chunk: string, flush: boolean) => {
    const next = consumeSse(buffer + chunk, pick, flush);
    buffer = next.rest;
    for (const piece of next.pieces) {
      full += piece;
      onDelta(piece);
    }
  };
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    eat(decoder.decode(value, { stream: true }), false);
  }
  eat(decoder.decode(), true);
  return full;
}

export async function streamChat(opts: {
  settings: Settings;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  onDelta: (chunk: string) => void;
  signal?: AbortSignal;
  skipVoice?: boolean;
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
  const messages = withVoice(opts.settings, opts.messages, opts.skipVoice);

  if (provider.kind === "ollama") {
    return streamOllamaChat({ ...opts, messages });
  }

  if (provider.kind === "anthropic") {
    const system = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const chat = messages
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
        messages: chat,
        stream: true,
      }),
      signal: opts.signal,
    });
    if (!res.ok) throw new Error(await errorText(res));
    return readSse(res.body, anthropicDelta, opts.onDelta);
  }

  if (provider.kind === "google") {
    const contents = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));
    const system = messages
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
    const system = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const chat = messages
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
          ? [{ role: "system", content: system }, ...chat]
          : chat,
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
      messages,
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
  return killEmDashes(
    out
      .trim()
      .replace(/^["']|["']$/g, "")
      .replace(/^```(?:\w+)?\n?|\n?```$/g, "")
      .trim(),
  );
}

function briefNote(brief?: string) {
  const text = brief?.trim();
  if (!text) return "";
  return `\n\nThey are writing against this scanned paper. Stay on its structure, limits, and any compliance rules. Do not restate the paper.\n---\n${text.slice(0, 8000)}`;
}

export async function flowContinue(
  settings: Settings,
  preceding: string,
  onDelta: (c: string) => void,
  signal?: AbortSignal,
  brief?: string,
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
          (enhance
            ? "You are in the sentence with the writer. They type fast and messy. Continue 15–40 words in their voice, slightly sharper and more concrete. Finish the thought they started. No quotes, no preamble, no restarting what they already wrote. If the thought is complete, return nothing."
            : "You are in the sentence with the writer. They type fast and messy. Continue 10–28 words in their exact voice as they meant it. Finish the fragment if it is unfinished. No quotes, no preamble, no restarting. If the thought is complete, return nothing.") +
            briefNote(brief),
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

export async function transform(settings: Settings, instruction: string, source: string, brief?: string) {
  let out = "";
  const long = source.trim().split(/\s+/).filter(Boolean).length > 80;
  await streamChat({
    settings,
    maxTokens: long ? 4000 : 1800,
    temperature: 0.55,
    messages: [
      {
        role: "system",
        content: writerSystem(
          "Rewrite or generate copy per the instruction. Return only the copy. You may use markdown: # ## ### headings, **bold**, *italic*. No commentary. No code fences. If the source is long, keep every section. Do not collapse it to one paragraph. Never use an em dash." +
            briefNote(brief),
        ),
      },
      {
        role: "user",
        content: `Instruction:\n${instruction}\n\nSource:\n${source || "(empty. Write from the instruction)"}`,
      },
    ],
    onDelta: (c) => {
      out += c;
    },
  });
  return cleanModelText(out);
}

export async function completeFromBrief(
  settings: Settings,
  brief: string,
  existing: string,
  onDelta: (chunk: string) => void,
  signal?: AbortSignal,
) {
  const paper = brief.trim().slice(0, 24000);
  const draft = existing.trim().slice(0, 8000);
  return streamChat({
    settings,
    maxTokens: 4000,
    temperature: 0.5,
    signal,
    messages: [
      {
        role: "system",
        content: writerSystem(
          "You complete take-homes, briefs, RFPs, and assignments. Read the paper. Infer the required parts, word limits, tone, and any compliance kit. Write the finished submission a strong human would turn in. Honor every constraint. Make guardrails invisible in the copy. Do not list banned phrases. Use markdown headings that match the requested structure (# ## ###). **Bold** sparingly. No preamble, no 'here is the assignment', no commentary, no code fences. Never use an em dash. If a draft is present, keep what works, fill what is missing, and stay on the brief.",
        ),
      },
      {
        role: "user",
        content: draft
          ? `PAPER\n${paper}\n\nDRAFT ON THE PAGE\n${draft}\n\nComplete the work.`
          : `PAPER\n${paper}\n\nThe page is empty. Write the full submission.`,
      },
    ],
    onDelta,
  });
}

export async function workshopChat(
  settings: Settings,
  opts: {
    page: string;
    selection: string;
    brief?: string;
    history: { role: "user" | "assistant"; content: string }[];
    question: string;
  },
  onDelta: (chunk: string) => void,
  signal?: AbortSignal,
) {
  const page = opts.page.trim().slice(0, 16000) || "(empty)";
  return streamChat({
    settings,
    maxTokens: 1400,
    temperature: 0.4,
    signal,
    messages: [
      {
        role: "system",
        content: writerSystem(
          "You are Workshop, a copy chief sitting next to the writer. You can see the PAGE. That is what is already written. Read it before you answer. Quote from it. Do not invent lines that are not on the page. Be direct. Prefer numerals, $ and % in ads, prices, and stats. Never spell those out. Never use an em dash. If a required stat was paraphrased, say so and give the exact line. Do not rewrite the whole page unless they ask. If you offer a line of copy, put it on its own paragraph. No cheerleading. No preamble." +
            briefNote(opts.brief) +
            `\n\nPAGE (already written)\n${page}`,
        ),
      },
      ...opts.history.slice(-10),
      {
        role: "user",
        content: `The page is already in your context. Use it.\n\nSELECTION\n${opts.selection.trim() || "(none. Talk about the whole page.)"}\n\nQUESTION\n${opts.question.trim()}`,
      },
    ],
    onDelta,
  });
}

export async function distillVoice(settings: Settings, corpus: string, signal?: AbortSignal) {
  const excerpt = excerptCorpus(corpus);
  if (excerpt.trim().length < 80) return "";
  let out = "";
  await streamChat({
    settings,
    skipVoice: true,
    maxTokens: 500,
    temperature: 0.2,
    signal,
    messages: [
      {
        role: "system",
        content: writerSystem(
          "You write a voice card another writer will follow. From the samples, describe how THIS person writes: sentence length, person (I/you/we), rhythm, diction, what they punch, what they never do. 8–14 short lines. Imperative. No preamble. No quotes of whole paragraphs. Never use an em dash.",
        ),
      },
      { role: "user", content: `SAMPLES\n${excerpt}` },
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
