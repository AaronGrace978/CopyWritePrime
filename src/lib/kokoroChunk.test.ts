import { chunkForKokoro, chunksCoverText, KOKORO_MAX_CHARS, looksTruncated, splitLongChunk } from "./kokoroChunk.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("chunkForKokoro", () => {
  it("keeps every word of a long page", () => {
    const text = [
      "You're fine. That's the problem.",
      "You already do the work. You eat like you mean it, you train, you show up for the physical, and they tell you you're fine.",
      "60% of members said Superpower identified something previously missed or overlooked by a doctor, not because someone failed, but because 10–15 markers was never a picture.",
      "Don't end the LP on the feature list. End on 93% and the tagline.",
    ].join(" ");
    const chunks = chunkForKokoro(text);
    assert.ok(chunks.length >= 2);
    assert.ok(chunks.every((c) => c.length <= KOKORO_MAX_CHARS));
    assert.equal(chunksCoverText(chunks, text), true);
  });

  it("splits a period-free rant without dropping the tail", () => {
    const words = Array.from({ length: 80 }, (_, i) => `word${i}`);
    const text = words.join(" ");
    const chunks = chunkForKokoro(text);
    assert.ok(chunks.length > 1);
    assert.equal(chunksCoverText(chunks, text), true);
    assert.ok(chunks.join(" ").includes("word79"));
  });

  it("splits a long comma chain", () => {
    const text = Array.from({ length: 40 }, (_, i) => `clause ${i} of the argument`).join(", ");
    const chunks = splitLongChunk(text, 80);
    assert.ok(chunks.length > 2);
    assert.equal(chunksCoverText(chunks, text), true);
  });

  it("flags audio that is too short for the text", () => {
    assert.equal(looksTruncated("x".repeat(200), 8000, 24000, 1), true);
    assert.equal(looksTruncated("x".repeat(200), 24000 * 8, 24000, 1), false);
    assert.equal(looksTruncated("Short.", 2000, 24000, 1), false);
  });
});
