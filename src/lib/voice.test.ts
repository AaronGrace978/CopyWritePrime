import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzeVoice, buildVoiceProfile, cardFromStats, traitsFromStats } from "./voice.ts";
import { allWorkshopMarkdown, workshopCount, workshopMarkdown } from "./logs.ts";
import { isAbortError } from "./abort.ts";

describe("voice", () => {
  it("reads a punchy second-person corpus", () => {
    const text = [
      "You're fine. That's the problem.",
      "You already do the work. You eat like you mean it.",
      "60% of members said Superpower identified something previously missed.",
      "Don't end the LP on the feature list. End on 93% and the tagline.",
    ].join("\n\n");
    const stats = analyzeVoice(text);
    const traits = traitsFromStats(stats);
    assert.ok(stats.words > 20);
    assert.equal(traits.person, "talks to you");
    assert.match(cardFromStats(stats, traits), /numerals|digits/i);
    const profile = buildVoiceProfile({
      text,
      samples: [{ name: "lp.txt", words: stats.words }],
      sourceLabel: "folder",
    });
    assert.ok(profile.card.includes("Write like this person"));
  });
});

describe("logs", () => {
  it("exports a workshop thread", () => {
    const md = workshopMarkdown("Home LP", [
      { role: "user", content: "Is $349 spelled out?" },
      { role: "assistant", content: "Keep $349. Don't spell it." },
    ]);
    assert.match(md, /## You/);
    assert.match(md, /\$349/);
    assert.equal(
      workshopCount([
        { title: "A", html: "<p></p>", updatedAt: 1, workshop: [{ role: "user", content: "x" }] },
      ]),
      1,
    );
    assert.match(allWorkshopMarkdown([]), /none/);
  });
});

describe("abort", () => {
  it("detects canceled fetch shapes", () => {
    assert.equal(isAbortError({ name: "AbortError", message: "Aborted" }), true);
    assert.equal(isAbortError({ name: "Error", message: "Request canceled" }), true);
    assert.equal(isAbortError({ name: "Error", message: "nope" }), false);
  });
});
