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

export function openaiDelta(json: Record<string, unknown>) {
  const choices = json.choices as
    | Array<{
        delta?: { content?: unknown };
        message?: { content?: unknown };
        text?: unknown;
      }>
    | undefined;
  const first = choices?.[0];
  return (
    asDeltaText(first?.delta?.content) ??
    asDeltaText(first?.message?.content) ??
    asDeltaText(first?.text)
  );
}

export function anthropicDelta(json: Record<string, unknown>) {
  if (json.type === "content_block_delta") {
    const delta = json.delta as { text?: string } | undefined;
    return delta?.text;
  }
  if (json.type === "content_block_start") {
    const content = json.content_block as { text?: string } | undefined;
    return content?.text;
  }
  return undefined;
}

export function geminiDelta(json: Record<string, unknown>) {
  const candidates = json.candidates as
    | Array<{ content?: { parts?: Array<{ text?: string }> } }>
    | undefined;
  const parts = candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((p) => p.text ?? "").join("");
  return text || undefined;
}

export function cohereDelta(json: Record<string, unknown>) {
  if (json.type === "content-delta") {
    const delta = json.delta as { message?: { content?: { text?: string } } } | undefined;
    return delta?.message?.content?.text;
  }
  const message = json.message as { content?: Array<{ text?: string }> } | undefined;
  const text = message?.content?.map((p) => p.text ?? "").join("") ?? "";
  return text || undefined;
}

function takeSseLine(line: string, pick: (json: Record<string, unknown>) => string | undefined): string {
  const trimmed = line.trim();
  if (!trimmed) return "";
  let payload = trimmed;
  if (payload.startsWith("data:")) payload = payload.slice(5).trim();
  if (!payload || payload === "[DONE]") return "";
  try {
    const json = JSON.parse(payload) as Record<string, unknown>;
    return pick(json) ?? "";
  } catch {
    return "";
  }
}

/** Parse complete SSE lines from a buffer. When flush is true, also parse a trailing partial line. */
export function consumeSse(
  buffer: string,
  pick: (json: Record<string, unknown>) => string | undefined,
  flush = false,
): { rest: string; pieces: string[] } {
  const lines = buffer.split(/\r?\n/);
  const rest = flush ? "" : (lines.pop() ?? "");
  const source = flush ? lines : lines;
  const pieces: string[] = [];
  for (const line of source) {
    const piece = takeSseLine(line, pick);
    if (piece) pieces.push(piece);
  }
  if (flush && rest.trim()) {
    const piece = takeSseLine(rest, pick);
    if (piece) pieces.push(piece);
  }
  return { rest, pieces };
}

export function consumeNdjson(buffer: string, flush = false): { rest: string; pieces: string[]; error?: string } {
  const lines = buffer.split(/\r?\n/);
  const rest = flush ? "" : (lines.pop() ?? "");
  const source = flush ? lines : lines;
  const pieces: string[] = [];
  const parseLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const json = JSON.parse(trimmed) as {
      message?: { content?: string };
      error?: string;
    };
    if (json.error) throw new Error(json.error);
    if (json.message?.content) pieces.push(json.message.content);
  };
  try {
    for (const line of source) parseLine(line);
    if (flush && rest.trim()) parseLine(rest);
  } catch (e) {
    if (e instanceof SyntaxError) return { rest: flush ? "" : rest, pieces };
    throw e;
  }
  return { rest, pieces };
}
