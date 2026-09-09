import { encodeWav, SILENT_WAV } from "./wav.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("encodeWav", () => {
  it("writes a PCM header the browser can play", async () => {
    const samples = new Float32Array(2400);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.sin((i / 24000) * 440 * 2 * Math.PI) * 0.2;
    const blob = encodeWav(samples, 24000);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    assert.equal(String.fromCharCode(...bytes.slice(0, 4)), "RIFF");
    assert.equal(String.fromCharCode(...bytes.slice(8, 12)), "WAVE");
    assert.equal(bytes.byteLength, 44 + samples.length * 2);
  });

  it("ships a silent unlock clip", () => {
    assert.match(SILENT_WAV, /^data:audio\/wav;base64,/);
  });
});
