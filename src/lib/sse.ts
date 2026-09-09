export type Json = Record<string, unknown>;

export function asDeltaText(value: unknown): string | undefined {
  if (typeof value === "string") return value || undefined;
  if (!Array.isArray(value)) return undefined;
  const joined = value
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part) {
        return String((part as { text?: unknown }).text ?? "");
      }
      return "";
    })
    .join("");
  return joined || undefined;
}

type OpenAiChoice = {
  delta?: { content?: unknown; reasoning_content?: unknown; reasoning?: unknown };
  message?: { content?: unknown; reasoning_content?: unknown; reasoning?: unknown };
  text?: unknown;
  finish_reason?: unknown;
};

function firstChoice(json: Json): OpenAiChoice | undefined {
  const choices = json.choices as OpenAiChoice[] | undefined;
  return choices?.[0];
}

export function openaiDelta(json: Json) {
  const first = firstChoice(json);
  return (
    asDeltaText(first?.delta?.content) ??
    asDeltaText(first?.message?.content) ??
    asDeltaText(first?.text)
  );
}

export function anthropicDelta(json: Json) {
  if (json.type === "content_block_delta") {
    const delta = json.delta as { type?: string; text?: string } | undefined;
    if (delta?.type && delta.type !== "text_delta") return undefined;
    return delta?.text;
  }
  if (json.type === "content_block_start") {
    const content = json.content_block as { type?: string; text?: string } | undefined;
    if (content?.type && content.type !== "text") return undefined;
    return content?.text;
  }
  return undefined;
}

type GeminiPart = { text?: string; thought?: boolean };

function geminiParts(json: Json): GeminiPart[] {
  const candidates = json.candidates as Array<{ content?: { parts?: GeminiPart[] } }> | undefined;
  return candidates?.[0]?.content?.parts ?? [];
}

export function geminiDelta(json: Json) {
  const text = geminiParts(json)
    .filter((p) => !p.thought)
    .map((p) => p.text ?? "")
    .join("");
  return text || undefined;
}

export function cohereDelta(json: Json) {
  if (json.type === "content-delta") {
    const delta = json.delta as { message?: { content?: { text?: string } } } | undefined;
    return delta?.message?.content?.text;
  }
  const message = json.message as { content?: Array<{ text?: string }> } | undefined;
  const text = message?.content?.map((p) => p.text ?? "").join("") ?? "";
  return text || undefined;
}

/**
 * Reasoning-trace text from any provider we speak. Models such as GLM, Qwen 3, DeepSeek R1,
 * gpt-oss, and Claude with extended thinking stream this before the answer. It is never part
 * of the reply, but it is proof the model is alive, so the UI shows it as "Thinking".
 */
export function thinkingDelta(json: Json): string | undefined {
  const first = firstChoice(json);
  const openai =
    asDeltaText(first?.delta?.reasoning_content) ??
    asDeltaText(first?.delta?.reasoning) ??
    asDeltaText(first?.message?.reasoning_content) ??
    asDeltaText(first?.message?.reasoning);
  if (openai) return openai;
  if (json.type === "content_block_delta") {
    const delta = json.delta as { type?: string; thinking?: string } | undefined;
    if (delta?.type === "thinking_delta") return delta.thinking || undefined;
  }
  const gemini = geminiParts(json)
    .filter((p) => p.thought)
    .map((p) => p.text ?? "")
    .join("");
  if (gemini) return gemini;
  const message = json.message as { thinking?: unknown } | undefined;
  return asDeltaText(message?.thinking);
}

/** Why the model stopped, normalised to "length" | "stop" | other provider strings. */
export function finishReason(json: Json): string | undefined {
  const first = firstChoice(json);
  if (typeof first?.finish_reason === "string" && first.finish_reason) return first.finish_reason;
  if (json.type === "message_delta") {
    const delta = json.delta as { stop_reason?: string } | undefined;
    if (delta?.stop_reason) return delta.stop_reason === "max_tokens" ? "length" : delta.stop_reason;
  }
  const candidates = json.candidates as Array<{ finishReason?: string }> | undefined;
  const gemini = candidates?.[0]?.finishReason;
  if (gemini) return gemini === "MAX_TOKENS" ? "length" : gemini.toLowerCase();
  if (typeof json.done_reason === "string" && json.done_reason) return json.done_reason;
  if (json.type === "message-end") {
    const delta = json.delta as { finish_reason?: string } | undefined;
    if (delta?.finish_reason) return delta.finish_reason === "MAX_TOKENS" ? "length" : delta.finish_reason.toLowerCase();
  }
  return undefined;
}

function parseSseLine(line: string): Json | undefined {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(":")) return undefined;
  let payload = trimmed;
  if (payload.startsWith("data:")) payload = payload.slice(5).trim();
  else if (/^(event|id|retry):/.test(payload)) return undefined;
  if (!payload || payload === "[DONE]") return undefined;
  try {
    const json = JSON.parse(payload) as unknown;
    return json && typeof json === "object" && !Array.isArray(json) ? (json as Json) : undefined;
  } catch {
    return undefined;
  }
}

/** Split an SSE buffer into complete JSON events. When flush is true, also parse a trailing partial line. */
export function consumeSseJson(buffer: string, flush = false): { rest: string; events: Json[] } {
  const lines = buffer.split(/\r?\n/);
  const rest = flush ? "" : (lines.pop() ?? "");
  const events: Json[] = [];
  for (const line of lines) {
    const json = parseSseLine(line);
    if (json) events.push(json);
  }
  return { rest, events };
}

/** Parse complete SSE lines from a buffer. When flush is true, also parse a trailing partial line. */
export function consumeSse(
  buffer: string,
  pick: (json: Json) => string | undefined,
  flush = false,
): { rest: string; pieces: string[] } {
  const { rest, events } = consumeSseJson(buffer, flush);
  const pieces: string[] = [];
  for (const json of events) {
    const piece = pick(json);
    if (piece) pieces.push(piece);
  }
  return { rest, pieces };
}

export interface NdjsonBatch {
  rest: string;
  pieces: string[];
  thoughts: string[];
  done?: string;
}

/**
 * Parse Ollama's NDJSON chat stream. A malformed line is skipped rather than poisoning the
 * lines after it. `message.thinking` goes to `thoughts`, `message.content` to `pieces`.
 */
export function consumeNdjson(buffer: string, flush = false): NdjsonBatch {
  const lines = buffer.split(/\r?\n/);
  const rest = flush ? "" : (lines.pop() ?? "");
  const pieces: string[] = [];
  const thoughts: string[] = [];
  let done: string | undefined;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let json: { message?: { content?: string; thinking?: string }; error?: string; done?: boolean; done_reason?: string };
    try {
      json = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (json.error) throw new Error(json.error);
    if (json.message?.thinking) thoughts.push(json.message.thinking);
    if (json.message?.content) pieces.push(json.message.content);
    if (json.done) done = json.done_reason || "stop";
  }
  return { rest, pieces, thoughts, done };
}
