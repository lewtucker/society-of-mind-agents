/**
 * Basic tests for EventLog using Node's built-in test runner.
 * Run with: npm test
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventLog } from "./EventLog.ts";

let tmpDir: string;
let dbPath: string;

before(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "som-eventlog-test-"));
  dbPath = join(tmpDir, "test.db");
});

after(async () => {
  await rm(tmpDir, { recursive: true });
});

describe("EventLog", () => {
  it("opens and creates schema without error", () => {
    const log = EventLog.open(dbPath);
    assert.equal(log.count(), 0);
    log.close();
  });

  it("emit() writes an event and returns a ULID", () => {
    const log = EventLog.open(dbPath);
    const id = log.emit({
      source: "test-agent",
      signal: "test.signal",
      type: "activation",
      payload: { foo: "bar" },
      context: { pronomes: {}, frame_id: null, kline_ids: [], micronemes: [] },
      causedBy: null,
    });
    assert.match(id, /^[0-9A-Z]{26}$/); // ULID format
    assert.equal(log.count(), 1);
    log.close();
  });

  it("recent() returns events oldest-first", () => {
    const log = EventLog.open(dbPath);
    log.emit({ source: "a", signal: "s1", type: "polyneme", payload: {}, context: { pronomes: {}, frame_id: null, kline_ids: [], micronemes: [] }, causedBy: null });
    log.emit({ source: "b", signal: "s2", type: "polyneme", payload: {}, context: { pronomes: {}, frame_id: null, kline_ids: [], micronemes: [] }, causedBy: null });

    const events = log.recent(10);
    assert.ok(events.length >= 2);
    // Oldest first: ids should be ascending
    for (let i = 1; i < events.length; i++) {
      assert.ok(events[i].id > events[i - 1].id);
    }
    log.close();
  });

  it("recent(limit, since) returns only events after the given id", () => {
    const log = EventLog.open(dbPath);
    const allBefore = log.recent(1000);
    const pivot = allBefore[Math.floor(allBefore.length / 2)].id;
    const after = log.recent(1000, pivot);
    assert.ok(after.every((e) => e.id > pivot));
    log.close();
  });

  it("payload and context round-trip through JSON", () => {
    const log = EventLog.open(dbPath);
    const id = log.emit({
      source: "agent-x",
      signal: "block.found",
      type: "polyneme",
      payload: { blockId: "A", position: [2, 0] },
      context: {
        pronomes: { Actor: "builder", Goal: "tower-3" },
        frame_id: "frame-builder-001",
        kline_ids: ["kl-001"],
        micronemes: [0.1, 0.2, 0.3],
      },
      causedBy: null,
    });

    const events = log.recent(1, id.slice(0, -1)); // get this event via since
    // recent(since) returns events AFTER since, so use a slightly earlier id
    const all = log.recent(1000);
    const found = all.find((e) => e.id === id);
    assert.ok(found);
    assert.deepEqual(found.payload, { blockId: "A", position: [2, 0] });
    assert.deepEqual(found.context.pronomes, { Actor: "builder", Goal: "tower-3" });
    assert.equal(found.context.frame_id, "frame-builder-001");
    assert.deepEqual(found.context.kline_ids, ["kl-001"]);
    log.close();
  });

  it("tail() delivers new events after the cursor", (_, done) => {
    const log = EventLog.open(dbPath);
    const startCount = log.count();
    const received: string[] = [];

    const stop = log.tail({
      since: log.recent(1).at(-1)?.id ?? "",
      pollMs: 50,
      onEvent: (e) => {
        received.push(e.signal);
        if (received.length === 2) {
          stop();
          log.close();
          assert.deepEqual(received, ["tail.one", "tail.two"]);
          done();
        }
      },
    });

    // Emit two events after setting up the tail
    setTimeout(() => {
      log.emit({ source: "tail-test", signal: "tail.one", type: "activation", payload: {}, context: { pronomes: {}, frame_id: null, kline_ids: [], micronemes: [] }, causedBy: null });
      log.emit({ source: "tail-test", signal: "tail.two", type: "activation", payload: {}, context: { pronomes: {}, frame_id: null, kline_ids: [], micronemes: [] }, causedBy: null });
    }, 75);
  });

  it("causedBy links are preserved", () => {
    const log = EventLog.open(dbPath);
    const parentId = log.emit({
      source: "parent-agent", signal: "parent.signal", type: "polyneme",
      payload: {}, context: { pronomes: {}, frame_id: null, kline_ids: [], micronemes: [] },
      causedBy: null,
    });
    const childId = log.emit({
      source: "child-agent", signal: "child.signal", type: "polyneme",
      payload: {}, context: { pronomes: {}, frame_id: null, kline_ids: [], micronemes: [] },
      causedBy: parentId,
    });

    const all = log.recent(1000);
    const child = all.find((e) => e.id === childId);
    assert.equal(child?.causedBy, parentId);
    log.close();
  });
});
