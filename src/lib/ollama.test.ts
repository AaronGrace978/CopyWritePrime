import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ollamaBudget, ollamaThink } from "./ollamaThink.ts";

describe("ollamaThink", () => {
  it("turns thinking off unless Reasoning is on", () => {
    assert.equal(ollamaThink("glm-5.3-flash", false), false);
    assert.equal(ollamaThink("glm-5.3-flash", true), true);
  });

  it("cannot disable gpt-oss thinking, only turn it down", () => {
    assert.equal(ollamaThink("gpt-oss:120b", false), "low");
    assert.equal(ollamaThink("gpt-oss:20b-cloud", true), "high");
  });
});

describe("ollamaBudget", () => {
  it("leaves the reply budget alone when thinking is off", () => {
    assert.equal(ollamaBudget(1400, false), 1400);
  });

  it("adds headroom when thinking is on so the answer is not starved", () => {
    assert.equal(ollamaBudget(1400, "low"), 2400);
    assert.equal(ollamaBudget(1400, true), 5400);
  });
});
