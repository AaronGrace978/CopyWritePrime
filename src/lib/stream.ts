/** How long we wait for the first byte. Local Ollama may still be loading a model. */
export const FIRST_BYTE_MS = 75_000;
/** How long the stream may go silent mid-reply before we give up on it. */
export const IDLE_MS = 45_000;

export class StallError extends Error {
  readonly phase: "first-byte" | "idle";
  readonly waitedMs: number;
  constructor(phase: "first-byte" | "idle", waitedMs: number, label: string) {
    const secs = Math.round(waitedMs / 1000);
    super(
      phase === "first-byte"
        ? `${label} sent nothing for ${secs}s. Check the model name and your connection, then ask again.`
        : `${label} went quiet mid-reply for ${secs}s. Ask again, or pick a faster model.`,
    );
    this.name = "StallError";
    this.phase = phase;
    this.waitedMs = waitedMs;
  }
}

export interface Watchdog {
  signal: AbortSignal;
  /** Call on every byte that arrives. Resets the idle timer. */
  touch: () => void;
  /** Stop the timers. Call when the stream ends, however it ends. */
  stop: () => void;
  /** The StallError to throw instead of the raw abort, if the watchdog fired. */
  stalled: () => StallError | null;
}

/**
 * Wraps a caller's AbortSignal with two timers. A user abort passes through untouched; a
 * silent provider gets cut off with a StallError that says what happened.
 */
export function watchdog(
  outer: AbortSignal | undefined,
  label: string,
  limits: { firstByteMs?: number; idleMs?: number } = {},
): Watchdog {
  const firstByteMs = limits.firstByteMs ?? FIRST_BYTE_MS;
  const idleMs = limits.idleMs ?? IDLE_MS;
  const ac = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stall: StallError | null = null;
  let sawByte = false;
  let stopped = false;

  const arm = (ms: number) => {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      if (stopped || ac.signal.aborted) return;
      stall = new StallError(sawByte ? "idle" : "first-byte", ms, label);
      ac.abort();
    }, ms);
  };

  const onOuterAbort = () => ac.abort();
  if (outer?.aborted) ac.abort();
  else outer?.addEventListener("abort", onOuterAbort, { once: true });

  arm(firstByteMs);

  return {
    signal: ac.signal,
    touch: () => {
      sawByte = true;
      arm(idleMs);
    },
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      outer?.removeEventListener("abort", onOuterAbort);
    },
    stalled: () => stall,
  };
}

export interface StreamBatch {
  rest: string;
  pieces: string[];
  thoughts?: string[];
  done?: string;
}

export interface StreamHandlers {
  onDelta: (chunk: string) => void;
  onThinking?: (chunk: string) => void;
  /** Called on every network read so a watchdog can be kept alive. */
  onActivity?: () => void;
}

export interface StreamResult {
  text: string;
  thinking: string;
  finish?: string;
}

/**
 * Drain a streamed body through a line parser. Text deltas go to onDelta, reasoning traces to
 * onThinking. The parser owns the buffer format (SSE or NDJSON); this owns decoding and flush.
 */
export async function readStream(
  body: ReadableStream<Uint8Array> | null,
  parse: (buffer: string, flush: boolean) => StreamBatch,
  handlers: StreamHandlers,
): Promise<StreamResult> {
  if (!body) throw new Error("Empty response body");
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const result: StreamResult = { text: "", thinking: "" };
  const eat = (chunk: string, flush: boolean) => {
    const next = parse(buffer + chunk, flush);
    buffer = next.rest;
    for (const thought of next.thoughts ?? []) {
      result.thinking += thought;
      handlers.onThinking?.(thought);
    }
    for (const piece of next.pieces) {
      result.text += piece;
      handlers.onDelta(piece);
    }
    if (next.done) result.finish = next.done;
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      handlers.onActivity?.();
      eat(decoder.decode(value, { stream: true }), false);
    }
    eat(decoder.decode(), true);
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Lock already gone (aborted or errored body). Nothing to release.
    }
  }
  return result;
}
