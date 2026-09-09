import { chunkForKokoro, chunksCoverText, looksTruncated, splitLongChunk, type KokoroVoiceId } from "./kokoroChunk";

export { KOKORO_VOICES, chunkForKokoro, chunksCoverText } from "./kokoroChunk";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

type RawClip = { audio: Float32Array; sampling_rate: number };

type TtsEngine = {
  generate: (text: string, opts?: { voice?: string; speed?: number }) => Promise<RawClip>;
};

type ProgressCb = (info: { status?: string; file?: string; progress?: number }) => void;

let engine: TtsEngine | null = null;
let loadPromise: Promise<TtsEngine> | null = null;
let playGen = 0;
const sources: AudioBufferSourceNode[] = [];
let ctx: AudioContext | null = null;
let genLock: Promise<void> = Promise.resolve();

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = genLock.then(fn, fn);
  genLock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function loadEngine(onProgress?: (msg: string) => void): Promise<TtsEngine> {
  if (engine) return engine;
  if (!loadPromise) {
    loadPromise = (async () => {
      onProgress?.("Loading Kokoro. First time downloads the voice…");
      const { KokoroTTS } = await import("kokoro-js");
      const progress_callback: ProgressCb = (info) => {
        if (info.status === "progress" && info.file) {
          const pct = typeof info.progress === "number" ? Math.round(info.progress) : 0;
          onProgress?.(`Kokoro ${info.file.split("/").pop()} ${pct}%`);
        } else if (info.status === "ready") {
          onProgress?.("Kokoro is ready.");
        }
      };
      const tts = await KokoroTTS.from_pretrained(MODEL_ID, {
        dtype: "q8",
        device: "wasm",
        progress_callback,
      });
      const wrapped: TtsEngine = {
        generate: (text, opts) => tts.generate(text, { voice: opts?.voice as "af_heart", speed: opts?.speed }),
      };
      engine = wrapped;
      return wrapped;
    })().catch((e) => {
      loadPromise = null;
      throw e;
    });
  }
  const loaded = await loadPromise;
  if (!loaded) throw new Error("Kokoro failed to load.");
  return loaded;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function generateOnce(tts: TtsEngine, text: string, voice: string, speed: number): Promise<RawClip> {
  return withLock(() => tts.generate(text, { voice, speed }));
}

async function generateFully(
  tts: TtsEngine,
  text: string,
  voice: string,
  speed: number,
  depth = 0,
): Promise<RawClip[]> {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) return [];
  try {
    const clip = await generateOnce(tts, trimmed, voice, speed);
    const samples = clip.audio;
    const rate = clip.sampling_rate || 24000;
    if (!samples?.length) throw new Error("empty audio");
    if (looksTruncated(trimmed, samples.length, rate, speed) && trimmed.length > 40 && depth < 5) {
      const halves = splitLongChunk(trimmed, Math.max(40, Math.ceil(trimmed.length / 2)));
      if (halves.length > 1) {
        const out: RawClip[] = [];
        for (const part of halves) out.push(...(await generateFully(tts, part, voice, speed, depth + 1)));
        return out;
      }
    }
    return [{ audio: samples, sampling_rate: rate }];
  } catch (e) {
    if (depth >= 5 || trimmed.split(/\s+/).length <= 3) throw e;
    await sleep(160);
    const halves = splitLongChunk(trimmed, Math.max(24, Math.ceil(trimmed.length / 2)));
    if (halves.length <= 1) {
      await sleep(240);
      const retry = await generateOnce(tts, trimmed, voice, speed);
      return [{ audio: retry.audio, sampling_rate: retry.sampling_rate || 24000 }];
    }
    const out: RawClip[] = [];
    for (const part of halves) out.push(...(await generateFully(tts, part, voice, speed, depth + 1)));
    return out;
  }
}

function stopSources() {
  for (const src of sources.splice(0)) {
    try {
      src.stop();
    } catch {
      /* already ended */
    }
    try {
      src.disconnect();
    } catch {
      /* ignore */
    }
  }
}

export function stopKokoro() {
  playGen += 1;
  stopSources();
  if (ctx && ctx.state !== "closed") {
    void ctx.suspend();
  }
}

function ensureContext() {
  if (!ctx || ctx.state === "closed") {
    ctx = new AudioContext({ sampleRate: 24000 });
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function scheduleClip(audioCtx: AudioContext, clip: RawClip, when: number) {
  const rate = clip.sampling_rate || 24000;
  const data = clip.audio;
  const buffer = audioCtx.createBuffer(1, data.length, rate);
  buffer.getChannelData(0).set(data);
  const src = audioCtx.createBufferSource();
  src.buffer = buffer;
  const gain = audioCtx.createGain();
  const fade = 0.018;
  gain.gain.setValueAtTime(0, when);
  gain.gain.linearRampToValueAtTime(1, when + fade);
  const end = when + buffer.duration;
  if (buffer.duration > fade * 2) {
    gain.gain.setValueAtTime(1, end - fade);
    gain.gain.linearRampToValueAtTime(0.0001, end);
  }
  src.connect(gain);
  gain.connect(audioCtx.destination);
  src.start(when);
  sources.push(src);
  src.onended = () => {
    const i = sources.indexOf(src);
    if (i >= 0) sources.splice(i, 1);
  };
  return buffer.duration;
}

export type KokoroListenOpts = {
  voice?: KokoroVoiceId;
  speed?: number;
  onStatus?: (msg: string) => void;
};

export async function listenWithKokoro(text: string, opts: KokoroListenOpts = {}) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) throw new Error("Nothing on the page to read.");
  const chunks = chunkForKokoro(cleaned);
  if (!chunks.length) throw new Error("Nothing on the page to read.");
  if (!chunksCoverText(chunks, cleaned)) {
    throw new Error("Kokoro split lost words. That should not happen.");
  }

  stopKokoro();
  const gen = playGen;
  const voice = opts.voice || "af_heart";
  const speed = Math.min(1.4, Math.max(0.7, opts.speed ?? 1));
  const tts = await loadEngine(opts.onStatus);
  if (gen !== playGen) return;

  const audioCtx = ensureContext();
  let nextTime = audioCtx.currentTime + 0.05;
  let skipped = 0;

  for (let i = 0; i < chunks.length; i++) {
    if (gen !== playGen) return;
    const piece = chunks[i];
    opts.onStatus?.(`Kokoro ${i + 1}/${chunks.length} · ${piece.slice(0, 52)}${piece.length > 52 ? "…" : ""}`);
    try {
      const clips = await generateFully(tts, piece, voice, speed);
      if (gen !== playGen) return;
      for (const clip of clips) {
        if (gen !== playGen) return;
        const dur = scheduleClip(audioCtx, clip, nextTime);
        nextTime += Math.max(0.05, dur - 0.012);
      }
    } catch {
      skipped += 1;
      const bits = splitLongChunk(piece, Math.max(24, Math.ceil(piece.length / 2)));
      if (bits.length > 1) {
        for (const bit of bits) {
          if (gen !== playGen) return;
          try {
            const clips = await generateFully(tts, bit, voice, speed);
            for (const clip of clips) {
              const dur = scheduleClip(audioCtx, clip, nextTime);
              nextTime += Math.max(0.05, dur - 0.012);
            }
            skipped -= 1;
          } catch {
            /* keep going so the rest of the page still plays */
          }
        }
      }
    }
    const ahead = nextTime - audioCtx.currentTime;
    if (ahead > 10) {
      while (gen === playGen && nextTime - audioCtx.currentTime > 4) {
        await sleep(200);
      }
    }
  }

  if (gen !== playGen) return;
  const remain = Math.max(0, nextTime - audioCtx.currentTime);
  await sleep(remain * 1000 + 80);
  if (gen !== playGen) return;
  opts.onStatus?.(
    skipped
      ? `Kokoro finished. ${skipped} slice${skipped === 1 ? "" : "s"} hiccuped and were retried or skipped.`
      : "Kokoro finished the page.",
  );
}

export function kokoroIsLoading() {
  return Boolean(loadPromise && !engine);
}
