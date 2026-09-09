import { splitSentences } from "./prose.ts";

/** Stay under Kokoro's phoneme tokenizer cap. Longer chunks get silently truncated. */
export const KOKORO_MAX_CHARS = 180;

export const KOKORO_VOICES = [
  { id: "af_heart", label: "Heart · US" },
  { id: "af_bella", label: "Bella · US" },
  { id: "af_nicole", label: "Nicole · US" },
  { id: "af_sarah", label: "Sarah · US" },
  { id: "af_kore", label: "Kore · US" },
  { id: "am_michael", label: "Michael · US" },
  { id: "am_fenrir", label: "Fenrir · US" },
  { id: "am_puck", label: "Puck · US" },
  { id: "bf_emma", label: "Emma · UK" },
  { id: "bf_isabella", label: "Isabella · UK" },
  { id: "bm_george", label: "George · UK" },
  { id: "bm_fable", label: "Fable · UK" },
] as const;

export type KokoroVoiceId = (typeof KOKORO_VOICES)[number]["id"] | string;

function wordsOf(text: string) {
  return text.toLowerCase().match(/[a-z0-9'$%]+/g) ?? [];
}

export function chunksCoverText(chunks: string[], text: string) {
  return wordsOf(chunks.join(" ")).join(" ") === wordsOf(text).join(" ");
}

function splitOn(text: string, re: RegExp): string[] {
  const out: string[] = [];
  let last = 0;
  const copy = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  let m: RegExpExecArray | null;
  while ((m = copy.exec(text))) {
    const end = m.index + m[0].length;
    if (end <= last) {
      copy.lastIndex = last + 1;
      continue;
    }
    const piece = text.slice(last, end).trim();
    if (piece) out.push(piece);
    last = end;
  }
  const tail = text.slice(last).trim();
  if (tail) out.push(tail);
  return out.length ? out : [text.trim()].filter(Boolean);
}

export function splitLongChunk(text: string, maxChars = KOKORO_MAX_CHARS): string[] {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxChars) return [trimmed];

  const byPause = splitOn(trimmed, /[,;:]\s+/);
  const packed: string[] = [];
  let buf = "";
  const flush = () => {
    if (buf) packed.push(buf);
    buf = "";
  };
  for (const part of byPause) {
    if (part.length > maxChars) {
      flush();
      const words = part.split(/\s+/);
      let line = "";
      for (const w of words) {
        const next = line ? `${line} ${w}` : w;
        if (next.length > maxChars && line) {
          packed.push(line);
          line = w;
        } else {
          line = next;
        }
      }
      if (line) packed.push(line);
      continue;
    }
    const next = buf ? `${buf} ${part}` : part;
    if (next.length > maxChars && buf) {
      flush();
      buf = part;
    } else {
      buf = next;
    }
  }
  flush();
  return packed;
}

export function chunkForKokoro(text: string, maxChars = KOKORO_MAX_CHARS): string[] {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return [];
  const ranges = splitSentences(cleaned);
  const chunks: string[] = [];
  let buf = "";
  const push = (s: string) => {
    for (const piece of splitLongChunk(s, maxChars)) chunks.push(piece);
  };
  for (const range of ranges) {
    const sentence = cleaned.slice(range.start, range.end).trim();
    if (!sentence) continue;
    if (sentence.length > maxChars) {
      if (buf) {
        push(buf);
        buf = "";
      }
      push(sentence);
      continue;
    }
    const next = buf ? `${buf} ${sentence}` : sentence;
    if (next.length > maxChars && buf) {
      push(buf);
      buf = sentence;
    } else {
      buf = next;
    }
  }
  if (buf) push(buf);
  return chunks;
}

export function looksTruncated(text: string, sampleCount: number, sampleRate: number, speed = 1) {
  const chars = text.replace(/\s+/g, "").length;
  if (chars < 48 || sampleRate <= 0) return false;
  const seconds = sampleCount / sampleRate;
  const minSeconds = (chars / 32) / Math.max(0.5, speed);
  return seconds < minSeconds;
}
