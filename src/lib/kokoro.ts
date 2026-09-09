import { chunkForKokoro, chunksCoverText, looksTruncated, splitLongChunk, type KokoroVoiceId } from "./kokoroChunk";
import { encodeWav, SILENT_WAV } from "./wav";

export { KOKORO_VOICES, chunkForKokoro, chunksCoverText } from "./kokoroChunk";

type StatusFn = (msg: string) => void;

type WorkerOut =
  | { op: "status"; message: string }
  | { op: "ready" }
  | { op: "audio"; id: number; sampleRate: number; pcm: ArrayBuffer }
  | { op: "error"; id?: number; error: string };

let worker: Worker | null = null;
let workerReady = false;
let loadWaiters: Array<(ok: boolean, err?: string) => void> = [];
let reqId = 1;
const pending = new Map<number, { resolve: (clip: { samples: Float32Array; sampleRate: number }) => void; reject: (err: Error) => void }>();
let playGen = 0;
let currentAudio: HTMLAudioElement | null = null;
let audioCtx: AudioContext | null = null;
let unlocked = false;

function onWorkerMessage(event: MessageEvent<WorkerOut>) {
  const msg = event.data;
  if (msg.op === "status") {
    statusSink?.(msg.message);
    return;
  }
  if (msg.op === "ready") {
    workerReady = true;
    for (const wait of loadWaiters.splice(0)) wait(true);
    return;
  }
  if (msg.op === "error") {
    if (typeof msg.id === "number" && pending.has(msg.id)) {
      pending.get(msg.id)!.reject(new Error(msg.error));
      pending.delete(msg.id);
      return;
    }
    for (const wait of loadWaiters.splice(0)) wait(false, msg.error);
    return;
  }
  if (msg.op === "audio") {
    const job = pending.get(msg.id);
    if (!job) return;
    pending.delete(msg.id);
    job.resolve({ samples: new Float32Array(msg.pcm), sampleRate: msg.sampleRate || 24000 });
  }
}

let statusSink: StatusFn | undefined;

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("../workers/kokoro.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = onWorkerMessage;
  worker.onerror = (event) => {
    const err = event.message || "Kokoro worker failed.";
    for (const [, job] of pending) job.reject(new Error(err));
    pending.clear();
    for (const wait of loadWaiters.splice(0)) wait(false, err);
    worker = null;
    workerReady = false;
  };
  return worker;
}

function ensureLoaded(): Promise<void> {
  getWorker();
  if (workerReady) return Promise.resolve();
  return new Promise((resolve, reject) => {
    loadWaiters.push((ok, err) => (ok ? resolve() : reject(new Error(err || "Kokoro failed to load."))));
    getWorker().postMessage({ op: "load" });
  });
}

function generateInWorker(text: string, voice: string, speed: number) {
  const id = reqId++;
  return new Promise<{ samples: Float32Array; sampleRate: number }>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ op: "generate", id, text, voice, speed });
  });
}

export function unlockKokoroAudio() {
  if (typeof Audio === "undefined") return;
  if (!unlocked) {
    const ping = new Audio(SILENT_WAV);
    ping.volume = 0.01;
    void ping.play().then(
      () => {
        ping.pause();
        ping.src = "";
      },
      () => undefined,
    );
    try {
      audioCtx = audioCtx ?? new AudioContext();
      void audioCtx.resume();
    } catch {
      /* HTMLAudioElement can still work */
    }
    unlocked = true;
  } else if (audioCtx?.state === "suspended") {
    void audioCtx.resume();
  }
}

export function stopKokoro() {
  playGen += 1;
  if (currentAudio) {
    currentAudio.onended = null;
    currentAudio.onerror = null;
    currentAudio.pause();
    currentAudio.src = "";
    currentAudio = null;
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function playClip(samples: Float32Array, sampleRate: number, gen: number) {
  if (gen !== playGen) return;
  const blob = encodeWav(samples, sampleRate);
  const url = URL.createObjectURL(blob);
  const budget = Math.ceil((samples.length / Math.max(1, sampleRate)) * 1000) + 750;
  try {
    const el = new Audio(url);
    el.preload = "auto";
    currentAudio = el;
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => resolve(), budget);
      const done = () => {
        window.clearTimeout(timer);
        resolve();
      };
      el.onended = done;
      el.onerror = () => {
        window.clearTimeout(timer);
        void playViaContext(samples, sampleRate, gen).then(resolve, reject);
      };
      const start = el.play();
      if (start) {
        start.catch(() => {
          window.clearTimeout(timer);
          void playViaContext(samples, sampleRate, gen).then(resolve, reject);
        });
      }
    });
  } finally {
    if (currentAudio) {
      currentAudio.onended = null;
      currentAudio.onerror = null;
    }
    URL.revokeObjectURL(url);
  }
}

async function playViaContext(samples: Float32Array, sampleRate: number, gen: number) {
  if (gen !== playGen) return;
  audioCtx = audioCtx ?? new AudioContext();
  if (audioCtx.state === "suspended") await audioCtx.resume();
  const buffer = audioCtx.createBuffer(1, samples.length, sampleRate);
  buffer.getChannelData(0).set(samples);
  await new Promise<void>((resolve) => {
    const src = audioCtx!.createBufferSource();
    src.buffer = buffer;
    src.connect(audioCtx!.destination);
    src.onended = () => resolve();
    src.start();
  });
}

async function generateFully(
  text: string,
  voice: string,
  speed: number,
  depth = 0,
): Promise<Array<{ samples: Float32Array; sampleRate: number }>> {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) return [];
  try {
    const clip = await generateInWorker(trimmed, voice, speed);
    if (!clip.samples.length) throw new Error("empty audio");
    if (looksTruncated(trimmed, clip.samples.length, clip.sampleRate, speed) && trimmed.length > 40 && depth < 5) {
      const halves = splitLongChunk(trimmed, Math.max(40, Math.ceil(trimmed.length / 2)));
      if (halves.length > 1) {
        const out = [];
        for (const part of halves) out.push(...(await generateFully(part, voice, speed, depth + 1)));
        return out;
      }
    }
    return [clip];
  } catch (e) {
    if (depth >= 5 || trimmed.split(/\s+/).length <= 3) throw e;
    await sleep(120);
    const halves = splitLongChunk(trimmed, Math.max(24, Math.ceil(trimmed.length / 2)));
    if (halves.length <= 1) return [await generateInWorker(trimmed, voice, speed)];
    const out = [];
    for (const part of halves) out.push(...(await generateFully(part, voice, speed, depth + 1)));
    return out;
  }
}

export type KokoroListenOpts = {
  voice?: KokoroVoiceId;
  speed?: number;
  onStatus?: StatusFn;
};

export async function listenWithKokoro(text: string, opts: KokoroListenOpts = {}) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) throw new Error("Nothing on the page to read.");
  const chunks = chunkForKokoro(cleaned);
  if (!chunks.length) throw new Error("Nothing on the page to read.");
  if (!chunksCoverText(chunks, cleaned)) {
    throw new Error("Kokoro split lost words. That should not happen.");
  }

  unlockKokoroAudio();
  stopKokoro();
  const gen = playGen;
  statusSink = opts.onStatus;
  const voice = opts.voice || "af_heart";
  const speed = Math.min(1.4, Math.max(0.7, opts.speed ?? 1));

  opts.onStatus?.("Loading Kokoro…");
  await ensureLoaded();
  if (gen !== playGen) return;

  let skipped = 0;
  for (let i = 0; i < chunks.length; i++) {
    if (gen !== playGen) return;
    const piece = chunks[i];
    opts.onStatus?.(`Kokoro ${i + 1}/${chunks.length} · ${piece.slice(0, 52)}${piece.length > 52 ? "…" : ""}`);
    try {
      const clips = await generateFully(piece, voice, speed);
      if (gen !== playGen) return;
      for (const clip of clips) {
        if (gen !== playGen) return;
        await playClip(clip.samples, clip.sampleRate, gen);
      }
    } catch {
      skipped += 1;
      const bits = splitLongChunk(piece, Math.max(24, Math.ceil(piece.length / 2)));
      if (bits.length > 1) {
        for (const bit of bits) {
          if (gen !== playGen) return;
          try {
            const clips = await generateFully(bit, voice, speed);
            for (const clip of clips) await playClip(clip.samples, clip.sampleRate, gen);
            skipped -= 1;
          } catch {
            /* keep reading the rest */
          }
        }
      }
    }
  }

  if (gen !== playGen) return;
  opts.onStatus?.(
    skipped
      ? `Kokoro finished. ${skipped} slice${skipped === 1 ? "" : "s"} hiccuped and were retried or skipped.`
      : "Kokoro finished the page.",
  );
}

export function warmupKokoro(onStatus?: StatusFn) {
  statusSink = onStatus;
  try {
    getWorker();
  } catch {
    /* Listen will surface the error */
  }
}
