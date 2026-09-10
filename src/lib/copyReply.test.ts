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
});
