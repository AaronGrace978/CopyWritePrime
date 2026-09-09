import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { consumeNdjson, consumeSse, geminiDelta, openaiDelta } from "./sse.ts";

describe("consumeSse", () => {
  it("keeps a trailing partial line until flush", () => {
    const pick = openaiDelta;
    const first = consumeSse(
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\ndata: {"choices":[{"delta":{"content":"lo',
      pick,
      false,
    );
    assert.equal(first.pieces.join(""), "Hel");
    assert.match(first.rest, /content":"lo$/);
    const flushed = consumeSse(`${first.rest}"}}]}`, pick, true);
    assert.equal(flushed.pieces.join(""), "lo");
  });

  it("flushes a last JSON line that has no trailing newline", () => {
    const line = 'data: {"choices":[{"delta":{"content":"Yes."}}]}';
    const { pieces } = consumeSse(line, openaiDelta, true);
    assert.equal(pieces.join(""), "Yes.");
  });

  it("reads Gemini parts and OpenAI array content", () => {
    assert.equal(
      geminiDelta({ candidates: [{ content: { parts: [{ text: "A" }, { text: "B" }] } }] }),
      "AB",
    );
    assert.equal(
      openaiDelta({ choices: [{ delta: { content: [{ type: "text", text: "Hi" }] } }] }),
      "Hi",
    );
  });
});

describe("consumeNdjson", () => {
  it("flushes the last Ollama chunk", () => {
    const { pieces } = consumeNdjson('{"message":{"content":"On "}}\n{"message":{"content":"it."}}', true);
    assert.equal(pieces.join(""), "On it.");
  });
});
