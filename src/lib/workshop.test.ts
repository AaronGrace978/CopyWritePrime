import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isFailedWorkshopTurn, withoutFailedTail, workshopHistory } from "./workshop.ts";

describe("isFailedWorkshopTurn", () => {
  it("flags explicit failures and the old empty-reply line", () => {
    assert.equal(isFailedWorkshopTurn({ role: "assistant", content: "Ship it." }), false);
    assert.equal(isFailedWorkshopTurn({ role: "assistant", content: "Ship it.", failed: true }), true);
    assert.equal(isFailedWorkshopTurn({ role: "assistant", content: "Nothing came back. Ask again." }), true);
    assert.equal(isFailedWorkshopTurn({ role: "assistant", content: "Couldn't answer. model not found" }), true);
    assert.equal(isFailedWorkshopTurn({ role: "assistant", content: "Nothing came back from glm-5.3-flash. Try again." }), true);
    assert.equal(isFailedWorkshopTurn({ role: "user", content: "Nothing came back. Ask again." }), false);
  });
});

describe("withoutFailedTail", () => {
  it("drops the failed pair so a retry can replace it", () => {
    const turns = [
      { role: "user" as const, content: "first" },
      { role: "assistant" as const, content: "ok" },
      { role: "user" as const, content: "enhance this" },
      { role: "assistant" as const, content: "Nothing came back. Ask again." },
    ];
    assert.deepEqual(withoutFailedTail(turns), turns.slice(0, 2));
  });

  it("leaves a good thread alone", () => {
    const turns = [
      { role: "user" as const, content: "first" },
      { role: "assistant" as const, content: "ok" },
    ];
    assert.equal(withoutFailedTail(turns), turns);
  });
});

describe("workshopHistory", () => {
  it("keeps good turns and drops failed ones", () => {
    const history = workshopHistory([
      { role: "user", content: "look at the subject" },
      { role: "assistant", content: "Keep 2am." },
      { role: "user", content: "enhance this" },
      { role: "assistant", content: "Nothing came back. Ask again." },
    ]);
    assert.deepEqual(history, [
      { role: "user", content: "look at the subject" },
      { role: "assistant", content: "Keep 2am." },
    ]);
  });
});
