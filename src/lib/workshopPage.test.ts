import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  WORKSHOP_PAGE_BUDGET,
  clipWorkshopHistory,
  packPageForWorkshop,
  previewPage,
  wantsFullRewrite,
} from "./workshopPage.ts";

function bigPage(chars: number, extra = "") {
  const body = "The offer is $349 a year and the close is 93% of members stay.\n\n".repeat(
    Math.ceil(chars / 64),
  );
  return (extra + body).slice(0, chars);
}

describe("packPageForWorkshop", () => {
  it("sends a short page whole", () => {
    const packed = packPageForWorkshop("Keep $349. Don't spell it out.");
    assert.equal(packed.packed, false);
    assert.equal(packed.text, "Keep $349. Don't spell it out.");
    assert.equal(packed.sentChars, packed.text.length);
  });

  it("packs a huge page under budget with opening, close, and outline", () => {
    const page = [
      "# Home",
      "A".repeat(8000),
      "## Pricing",
      "B".repeat(8000),
      "MARKER_MIDDLE unique stretch the writer highlighted here",
      "## Close",
      "C".repeat(8000),
    ].join("\n\n");
    const packed = packPageForWorkshop(page, "MARKER_MIDDLE unique stretch the writer highlighted here");
    assert.equal(packed.packed, true);
    assert.ok(packed.originalChars > WORKSHOP_PAGE_BUDGET);
    assert.ok(packed.sentChars <= WORKSHOP_PAGE_BUDGET + 1500);
    assert.match(packed.text, /PAGE PACKED/);
    assert.match(packed.text, /OUTLINE/);
    assert.match(packed.text, /# Home/);
    assert.match(packed.text, /## Pricing/);
    assert.match(packed.text, /OPENING/);
    assert.match(packed.text, /CLOSING/);
    assert.match(packed.text, /AROUND SELECTION/);
    assert.match(packed.text, /MARKER_MIDDLE/);
    assert.ok(!packed.text.includes("B".repeat(2000)));
  });

  it("does not send 240k characters to the model", () => {
    const packed = packPageForWorkshop(bigPage(240_000, "# Brief\n\n"));
    assert.equal(packed.packed, true);
    assert.equal(packed.originalChars, 240_000);
    assert.ok(packed.sentChars < 20_000);
    assert.match(packed.text, /240000 characters/);
  });
});

describe("previewPage", () => {
  it("caps the rail preview so a 240k page cannot freeze the UI", () => {
    const preview = previewPage(bigPage(240_000));
    assert.ok(preview.length < 8_000);
    assert.match(preview, /more characters on the page/);
  });

  it("leaves a short page alone", () => {
    assert.equal(previewPage("Hello."), "Hello.");
  });
});

describe("wantsFullRewrite", () => {
  it("spots rewrite asks", () => {
    assert.equal(wantsFullRewrite("rewrite the whole page"), true);
    assert.equal(wantsFullRewrite("Should I spell out $349?"), false);
  });
});

describe("clipWorkshopHistory", () => {
  it("keeps the last turns and clips giant replies", () => {
    const history = Array.from({ length: 12 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: i === 11 ? "Z".repeat(8000) : `turn ${i}`,
    }));
    const clipped = clipWorkshopHistory(history);
    assert.equal(clipped.length, 8);
    assert.ok(clipped[7].content.length < 3600);
    assert.match(clipped[7].content, /…$/);
  });
});
