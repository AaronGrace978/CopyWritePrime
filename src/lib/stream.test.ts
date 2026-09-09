import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { StallError, readStream, watchdog } from "./stream.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function bodyOf(chunks: string[], gapMs = 0): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const chunk of chunks) {
        if (gapMs) await sleep(gapMs);
        controller.enqueue(enc.encode(chunk));
      }
      controller.close();
    },
  });
}

describe("watchdog", () => {
  it("fires a first-byte stall when nothing arrives", async () => {
    const dog = watchdog(undefined, "test model", { firstByteMs: 20, idleMs: 20 });
    await sleep(40);
    assert.ok(dog.signal.aborted);
    const stall = dog.stalled();
    assert.ok(stall instanceof StallError);
    assert.equal(stall?.phase, "first-byte");
    assert.match(stall!.message, /test model sent nothing/);
    dog.stop();
  });

  it("stays alive while bytes keep coming, then fires an idle stall", async () => {
    const dog = watchdog(undefined, "m", { firstByteMs: 30, idleMs: 30 });
    for (let i = 0; i < 4; i++) {
      await sleep(15);
      dog.touch();
    }
    assert.equal(dog.signal.aborted, false);
    await sleep(60);
    assert.ok(dog.signal.aborted);
    assert.equal(dog.stalled()?.phase, "idle");
    dog.stop();
  });

  it("passes a user abort through without a stall", async () => {
    const outer = new AbortController();
    const dog = watchdog(outer.signal, "m", { firstByteMs: 1000, idleMs: 1000 });
    outer.abort();
    assert.ok(dog.signal.aborted);
    assert.equal(dog.stalled(), null);
    dog.stop();
  });

  it("does nothing after stop", async () => {
    const dog = watchdog(undefined, "m", { firstByteMs: 10, idleMs: 10 });
    dog.stop();
    await sleep(30);
    assert.equal(dog.signal.aborted, false);
    assert.equal(dog.stalled(), null);
  });
});

describe("readStream", () => {
  const parse = (buffer: string, flush: boolean) => {
    const lines = buffer.split("\n");
    const rest = flush ? "" : (lines.pop() ?? "");
    const pieces: string[] = [];
    const thoughts: string[] = [];
    let done: string | undefined;
    for (const line of lines) {
      if (!line) continue;
      if (line.startsWith("think:")) thoughts.push(line.slice(6));
      else if (line.startsWith("done:")) done = line.slice(5);
      else pieces.push(line);
    }
    return { rest, pieces, thoughts, done };
  };

  it("routes text, thinking, and finish, and pings activity per read", async () => {
    const seen: string[] = [];
    const thought: string[] = [];
    let reads = 0;
    const result = await readStream(bodyOf(["think:plan\nHel", "lo\n", "done:stop\n"]), parse, {
      onDelta: (c) => seen.push(c),
      onThinking: (c) => thought.push(c),
      onActivity: () => reads++,
    });
    assert.deepEqual(seen, ["Hello"]);
    assert.deepEqual(thought, ["plan"]);
    assert.equal(result.text, "Hello");
    assert.equal(result.thinking, "plan");
    assert.equal(result.finish, "stop");
    assert.equal(reads, 3);
  });

  it("flushes a final line with no trailing newline", async () => {
    const result = await readStream(bodyOf(["A\nB"]), parse, { onDelta: () => undefined });
    assert.equal(result.text, "AB");
  });

  it("rejects an empty body", async () => {
    await assert.rejects(readStream(null, parse, { onDelta: () => undefined }), /Empty response body/);
  });
});
