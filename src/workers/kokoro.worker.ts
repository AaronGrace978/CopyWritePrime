/// <reference lib="webworker" />

import { env } from "@huggingface/transformers";
import { KokoroTTS } from "kokoro-js";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

env.allowLocalModels = false;
const wasm = env.backends.onnx.wasm;
if (wasm) {
  wasm.proxy = false;
  wasm.numThreads = 1;
}

type Incoming =
  | { op: "load" }
  | { op: "generate"; id: number; text: string; voice: string; speed: number };

let tts: KokoroTTS | null = null;
let loadPromise: Promise<KokoroTTS> | null = null;

function progressMessage(info: { status?: string; file?: string; progress?: number }) {
  if (info.status === "progress" && info.file) {
    const pct = typeof info.progress === "number" ? Math.round(info.progress) : 0;
    const name = info.file.split("/").pop() ?? info.file;
    return `Loading Kokoro · ${name} ${pct}%`;
  }
  if (info.status === "ready") return "Kokoro is ready.";
  if (info.status === "initiate" && info.file) return `Fetching ${info.file.split("/").pop()}`;
  return "";
}

async function loadModel() {
  if (tts) return tts;
  if (!loadPromise) {
    loadPromise = KokoroTTS.from_pretrained(MODEL_ID, {
      dtype: "q8",
      device: "wasm",
      progress_callback: (info) => {
        const message = progressMessage(info);
        if (message) self.postMessage({ op: "status", message });
      },
    }).then((model) => {
      tts = model;
      return model;
    }).catch((err) => {
      loadPromise = null;
      throw err;
    });
  }
  return loadPromise;
}

self.onmessage = async (event: MessageEvent<Incoming>) => {
  const msg = event.data;
  try {
    if (msg.op === "load") {
      self.postMessage({ op: "status", message: "Loading Kokoro. First listen downloads the voice…" });
      await loadModel();
      self.postMessage({ op: "ready" });
      return;
    }
    if (msg.op === "generate") {
      const model = await loadModel();
      const clip = await model.generate(msg.text, { voice: msg.voice as "af_heart", speed: msg.speed });
      const samples = clip.audio;
      const pcm = samples.buffer.slice(samples.byteOffset, samples.byteOffset + samples.byteLength);
      self.postMessage(
        { op: "audio", id: msg.id, sampleRate: clip.sampling_rate || 24000, pcm },
        [pcm],
      );
    }
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    self.postMessage({ op: "error", id: "id" in msg ? msg.id : undefined, error: text });
  }
};
