import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventLog } from "../event-log/index.ts";
import { PolynemeBus } from "./PolynemeBus.ts";

let tmpDir: string;
let log: EventLog;
let bus: PolynemeBus;

before(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "som-bus-test-"));
  log = EventLog.open(join(tmpDir, "test.db"));
  bus = new PolynemeBus(log);
});

after(async () => {
  log.close();
  await rm(tmpDir, { recursive: true });
});

// Helper: wait for queued microtasks to flush
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("PolynemeBus", () => {
  it("emit() persists to the event log", async () => {
    const countBefore = log.count();
    bus.emit({
      source: "test-agent",
      signal: "test.signal",
      type: "polyneme",
      payload: {},
      causedBy: null,
    });
    assert.equal(log.count(), countBefore + 1);
  });

  it("subscribers receive matching signals", async () => {
    const received: string[] = [];
    const sub = bus.subscribe({
      id: "listener-a",
      signals: ["block.found"],
      onSignal: (e) => received.push(e.signal),
    });

    bus.emit({ source: "find", signal: "block.found",  type: "polyneme", payload: {}, causedBy: null });
    bus.emit({ source: "find", signal: "block.search", type: "polyneme", payload: {}, causedBy: null });
    await flush();

    assert.deepEqual(received, ["block.found"]);
    sub.unsubscribe();
  });

  it("glob patterns fan out to all matching signals", async () => {
    const received: string[] = [];
    const sub = bus.subscribe({
      id: "block-watcher",
      signals: ["block.*"],
      onSignal: (e) => received.push(e.signal),
    });

    bus.emit({ source: "find", signal: "block.found",  type: "polyneme", payload: {}, causedBy: null });
    bus.emit({ source: "find", signal: "block.search", type: "polyneme", payload: {}, causedBy: null });
    bus.emit({ source: "put",  signal: "put.execute",  type: "activation", payload: {}, causedBy: null });
    await flush();

    assert.deepEqual(received, ["block.found", "block.search"]);
    sub.unsubscribe();
  });

  it("one signal activates multiple subscribers concurrently", async () => {
    const grasp: string[] = [];
    const move: string[] = [];

    const subGrasp = bus.subscribe({ id: "grasp", signals: ["block.found"], onSignal: (e) => grasp.push(e.id) });
    const subMove  = bus.subscribe({ id: "move",  signals: ["block.found"], onSignal: (e) => move.push(e.id) });

    const id = bus.emit({ source: "find", signal: "block.found", type: "polyneme", payload: { blockId: "A" }, causedBy: null });
    await flush();

    // Both received the same event id — concurrent activation from one signal
    assert.deepEqual(grasp, [id]);
    assert.deepEqual(move, [id]);

    subGrasp.unsubscribe();
    subMove.unsubscribe();
  });

  it("isonomes reach ALL subscribers regardless of filters", async () => {
    const received: string[] = [];
    const subA = bus.subscribe({ id: "iso-a", signals: ["specific.signal"], onSignal: (e) => received.push("a") });
    const subB = bus.subscribe({ id: "iso-b", signals: ["other.signal"],    onSignal: (e) => received.push("b") });

    bus.emitIsonome({ source: "bus", signal: "attention.shift", type: "isonome", payload: {}, causedBy: null });
    await flush();

    assert.ok(received.includes("a"), "iso-a should receive isonome");
    assert.ok(received.includes("b"), "iso-b should receive isonome");

    subA.unsubscribe();
    subB.unsubscribe();
  });

  it("type filter restricts delivery", async () => {
    const received: string[] = [];
    const sub = bus.subscribe({
      id: "type-filter",
      types: ["censor"],
      onSignal: (e) => received.push(e.type),
    });

    bus.emit({ source: "memory-manager", signal: "censor.fire",   type: "censor",     payload: {}, causedBy: null });
    bus.emit({ source: "find",           signal: "block.found",   type: "polyneme",   payload: {}, causedBy: null });
    bus.emit({ source: "builder",        signal: "builder.start", type: "activation", payload: {}, causedBy: null });
    await flush();

    assert.deepEqual(received, ["censor"]);
    sub.unsubscribe();
  });

  it("pronome bindings are injected into emitted signals", async () => {
    bus.bindPronome("Actor", "builder-001");
    bus.bindPronome("Goal",  "tower-3");
    await flush(); // flush the pronome-bind signals

    let captured: ReturnType<typeof bus.getPronomes> | null = null;
    const sub = bus.subscribe({
      id: "pronome-check",
      signals: ["step.start"],
      onSignal: (e) => { captured = e.context.pronomes; },
    });

    bus.emit({ source: "builder", signal: "step.start", type: "activation", payload: {}, causedBy: null });
    await flush();

    assert.ok(captured !== null);
    assert.equal((captured as Record<string,string>)["Actor"], "builder-001");
    assert.equal((captured as Record<string,string>)["Goal"],  "tower-3");

    bus.releasePronome("Actor");
    bus.releasePronome("Goal");
    sub.unsubscribe();
  });

  it("a throwing subscriber does not kill the bus", async () => {
    const received: string[] = [];

    const bad  = bus.subscribe({ id: "bad-sub",  signals: ["*"], onSignal: () => { throw new Error("boom"); } });
    const good = bus.subscribe({ id: "good-sub", signals: ["*"], onSignal: (e) => received.push(e.signal) });

    bus.emit({ source: "x", signal: "any.signal", type: "polyneme", payload: {}, causedBy: null });
    await flush();

    assert.ok(received.includes("any.signal"), "good subscriber still received after bad one threw");

    bad.unsubscribe();
    good.unsubscribe();
  });

  it("causedBy links survive to the event log", async () => {
    const parentId = bus.emit({ source: "a", signal: "parent", type: "polyneme", payload: {}, causedBy: null });
    const childId  = bus.emit({ source: "b", signal: "child",  type: "polyneme", payload: {}, causedBy: parentId });

    const all = log.recent(1000);
    const child = all.find((e) => e.id === childId);
    assert.equal(child?.causedBy, parentId);
  });
});
