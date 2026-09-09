import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  anthropicDelta,
  consumeNdjson,
  consumeSse,
  consumeSseJson,
  finishReason,
  geminiDelta,
  openaiDelta,
  thinkingDelta,
} from "./sse.ts";

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

  it("skips comments and event/id lines", () => {
    const { events } = consumeSseJson(': keep-alive\nevent: ping\nid: 4\ndata: {"a":1}\n', false);
    assert.deepEqual(events, [{ a: 1 }]);
  });

  it("keeps Gemini thought parts out of the reply", () => {
    const json = { candidates: [{ content: { parts: [{ text: "plan", thought: true }, { text: "Go." }] } }] };
    assert.equal(geminiDelta(json), "Go.");
    assert.equal(thinkingDelta(json), "plan");
  });

  it("keeps Anthropic thinking blocks out of the reply", () => {
    assert.equal(anthropicDelta({ type: "content_block_delta", delta: { type: "thinking_delta", thinking: "hm" } }), undefined);
    assert.equal(thinkingDelta({ type: "content_block_delta", delta: { type: "thinking_delta", thinking: "hm" } }), "hm");
    assert.equal(anthropicDelta({ type: "content_block_delta", delta: { type: "text_delta", text: "Yes" } }), "Yes");
  });
});

describe("thinkingDelta / finishReason", () => {
  it("reads OpenAI-style reasoning deltas", () => {
    assert.equal(thinkingDelta({ choices: [{ delta: { reasoning_content: "let me see" } }] }), "let me see");
    assert.equal(thinkingDelta({ choices: [{ delta: { reasoning: "hmm" } }] }), "hmm");
    assert.equal(openaiDelta({ choices: [{ delta: { reasoning_content: "let me see" } }] }), undefined);
  });

  it("reads Ollama thinking", () => {
    assert.equal(thinkingDelta({ message: { role: "assistant", thinking: "first," } }), "first,");
  });

  it("normalises finish reasons", () => {
    assert.equal(finishReason({ choices: [{ finish_reason: "length" }] }), "length");
    assert.equal(finishReason({ type: "message_delta", delta: { stop_reason: "max_tokens" } }), "length");
    assert.equal(finishReason({ candidates: [{ finishReason: "MAX_TOKENS" }] }), "length");
    assert.equal(finishReason({ done: true, done_reason: "stop" }), "stop");
    assert.equal(finishReason({ choices: [{ delta: { content: "x" } }] }), undefined);
  });
});

describe("consumeNdjson", () => {
  it("flushes the last Ollama chunk", () => {
    const { pieces } = consumeNdjson('{"message":{"content":"On "}}\n{"message":{"content":"it."}}', true);
    assert.equal(pieces.join(""), "On it.");
  });

  it("separates thinking from content and reports done_reason", () => {
    const out = consumeNdjson(
      [
        '{"message":{"role":"assistant","thinking":"The user wants"}}',
        '{"message":{"role":"assistant","thinking":" a headline."}}',
        '{"message":{"role":"assistant","content":"Ship it."}}',
        '{"message":{"role":"assistant","content":""},"done":true,"done_reason":"length"}',
      ].join("\n"),
      true,
    );
    assert.equal(out.thoughts.join(""), "The user wants a headline.");
    assert.equal(out.pieces.join(""), "Ship it.");
    assert.equal(out.done, "length");
  });

  it("skips a bad line without dropping the lines after it", () => {
    const out = consumeNdjson('{"message":{"content":"A"}}\n{oops\n{"message":{"content":"B"}}\n', false);
    assert.equal(out.pieces.join(""), "AB");
    assert.equal(out.rest, "");
  });

  it("holds a partial trailing line until flush", () => {
    const first = consumeNdjson('{"message":{"content":"A"}}\n{"message":{"con', false);
    assert.equal(first.pieces.join(""), "A");
    assert.equal(first.rest, '{"message":{"con');
    const second = consumeNdjson(`${first.rest}tent":"B"}}`, true);
    assert.equal(second.pieces.join(""), "B");
  });

  it("throws on an Ollama error line", () => {
    assert.throws(() => consumeNdjson('{"error":"model not found"}\n', false), /model not found/);
  });
});
