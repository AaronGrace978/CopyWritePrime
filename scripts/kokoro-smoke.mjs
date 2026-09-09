import { KokoroTTS } from "kokoro-js";
import { chunkForKokoro, chunksCoverText, looksTruncated } from "../src/lib/kokoroChunk.ts";

const text = [
  "You're fine. That's the problem.",
  "You already do the work. You eat like you mean it, you train, you show up for the physical, and they tell you you're fine.",
  "60% of members said Superpower identified something previously missed.",
  "Don't end the LP on the feature list. End on 93% and the tagline. Short-form is one talent, one car, one printout.",
].join(" ");

const chunks = chunkForKokoro(text);
if (!chunksCoverText(chunks, text)) {
  console.error("chunks lost words", chunks);
  process.exit(1);
}

console.log(`chunks=${chunks.length} first="${chunks[0]}" last="${chunks[chunks.length - 1]}"`);

const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
  dtype: "q8",
  device: "cpu",
  progress_callback: (info) => {
    if (info.status === "progress" && info.file && typeof info.progress === "number" && info.progress % 20 < 2) {
      console.log(`${info.file} ${Math.round(info.progress)}%`);
    }
  },
});

const clips = [];
for (const [i, piece] of chunks.entries()) {
  const audio = await tts.generate(piece, { voice: "af_heart", speed: 1 });
  const truncated = looksTruncated(piece, audio.audio.length, audio.sampling_rate, 1);
  const sec = audio.audio.length / audio.sampling_rate;
  console.log(`#${i + 1} chars=${piece.length} sec=${sec.toFixed(2)} truncated=${truncated}`);
  if (truncated) {
    console.error("chunk came back too short", piece);
    process.exit(2);
  }
  clips.push(audio.audio.length);
}

const total = clips.reduce((a, b) => a + b, 0);
console.log(`ok samples=${total} chunks=${clips.length}`);
