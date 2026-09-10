import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { stripLeakedThinking } from "./copyReply.ts";

const source = `Back in 2024, when I first discovered AI, I knew I wanted to change careers. In late June 2025, I resigned from my position at the college and moved home to learn all I could about AI.

Once I knew enough, I joined the MIT Sundai Club.`;

const cut = `Back in 2024, when I first discovered AI, I knew I wanted to change careers. In late June 2025, I resigned from my position at the college and moved home to learn all I could about AI.

Once I knew enough, I joined the MIT Sundai Club, submitted a few sloppily vibecoded projects, and attended about three sessions. Weeks later, I was told I was already a good developer. I took that as their benefit of the doubt and moved on to pitching projects at the Cambridge CIC. I knew it was the polite way of saying "get out of here." But I didn't relent. I took a day job in customer service to pay the bills and fund my own education.`;

describe("stripLeakedThinking", () => {
  it("returns a clean cut unchanged", () => {
    assert.equal(stripLeakedThinking(cut, source), cut);
  });

  it("drops think tags", () => {
    assert.equal(stripLeakedThinking(`<think>plan the edit</think>\n${cut}`, source), cut);
  });

  it("keeps copy after a 'the cut:' marker", () => {
    assert.equal(stripLeakedThinking(`The user wants just the fixed cut, no commentary.\n\nThe cut:\n${cut}`, source), cut);
  });

  it("drops paragraph-by-paragraph planning before the original opening", () => {
    const leak = `The user wants just the fixed cut, no commentary. Let me produce the final clean version of the whole page.

Paragraph 1: "Back in 2024..." - clean, keep.

Fix the broken sentence. Hmm, original had a double But. Wait, let me restructure.

${cut}`;
    assert.equal(stripLeakedThinking(leak, source), cut);
  });

  it("drops a bare NOOP", () => {
    assert.equal(stripLeakedThinking("NOOP", source), "");
  });

  it("drops a polish prompt echoed as copy", () => {
    const leak = `The task: fix spelling, grammar, missing words, punctuation. Keep voice, slang, rhythm. Don't add ideas, don't get fancier. Don't explain. First character of reply is first character of corrected sentence, or NOOP.

Original text:
"When I was a young boy, my father once told me"

Fixes needed:
- "Ai" → "AI" (spelling). Hmm, but keep voice? "Ai" is a misspelling of AI. I think correcting`;
    assert.equal(stripLeakedThinking(leak, "When I was a young boy, my father once told me that the only limitations are the ones you place on yourself"), "");
  });

  it("drops the Watch-box dump that restates the em-dash ban", () => {
    const leak = `The task: fix spelling, grammar, missing words, punctuation. Keep voice, slang, rhythm. Don't add ideas, don't get fancier. No em dashes, no horizontal bars, no "--" as pause. Use period, comma, colon, or new sentence.

Original text:
"When I was a young boy, my father once told me that the only limitations are the ones you place on yourself, with Ai I personally feel that this technology, this prediction engine"`;
    assert.equal(
      stripLeakedThinking(
        leak,
        "When I was a young boy, my father once told me that the only limitations are the ones you place on yourself, with Ai I personally feel that this technology, this prediction engine is a way for people to lift any and all restrictions placed on them",
      ),
      "",
    );
  });
});
