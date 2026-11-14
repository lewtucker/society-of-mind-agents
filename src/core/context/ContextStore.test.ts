import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContextStore } from "./ContextStore.ts";
import { EventLog } from "../event-log/index.ts";
import { PolynemeBus } from "../polyneme-bus/PolynemeBus.ts";

// ─── ContextStore unit tests ──────────────────────────────────────────────────

describe("ContextStore", () => {
  it("snapshot() returns empty context by default", () => {
    const store = new ContextStore();
    const snap = store.snapshot();
    assert.deepEqual(snap.pronomes, {});
    assert.equal(snap.frame_id, null);
    assert.deepEqual(snap.kline_ids, []);
    assert.deepEqual(snap.micronemes, []);
  });

  it("bind() and release() update pronomes", () => {
    const store = new ContextStore();
    store.bind("Actor", "grasp-agent");
    store.bind("Goal", "tower-top");
    assert.equal(store.getPronomes()["Actor"], "grasp-agent");
    assert.equal(store.getPronomes()["Goal"], "tower-top");

    store.release("Actor");
    assert.equal(store.getPronomes()["Actor"], undefined);
    assert.equal(store.getPronomes()["Goal"], "tower-top");
  });

  it("setFrame / getFrame round-trip", () => {
    const store = new ContextStore();
    assert.equal(store.getFrame(), null);
    store.setFrame("block-placement-frame");
    assert.equal(store.getFrame(), "block-placement-frame");
    store.setFrame(null);
    assert.equal(store.getFrame(), null);
  });

  it("setActiveKLines / getActiveKLines round-trip", () => {
    const store = new ContextStore();
    assert.deepEqual(store.getActiveKLines(), []);
    store.setActiveKLines(["kline-01", "kline-02"]);
    assert.deepEqual(store.getActiveKLines(), ["kline-01", "kline-02"]);
    store.setActiveKLines([]);
    assert.deepEqual(store.getActiveKLines(), []);
  });

  it("setMicronemes / getMicronemes round-trip", () => {
    const store = new ContextStore();
    assert.deepEqual(store.getMicronemes(), []);
    store.setMicronemes([0.1, 0.5, 0.9]);
    assert.deepEqual(store.getMicronemes(), [0.1, 0.5, 0.9]);
  });

  it("snapshot() is a defensive copy — mutations don't affect internal state", () => {
    const store = new ContextStore();
    store.bind("Actor", "agent-a");
    store.setActiveKLines(["kl-1"]);
    store.setMicronemes([0.5]);

    const snap = store.snapshot();
    snap.pronomes["Actor"] = "mutated";
    snap.kline_ids.push("injected");
    snap.micronemes.push(99);

    // Internal state unchanged
    assert.equal(store.getPronomes()["Actor"], "agent-a");
    assert.deepEqual(store.getActiveKLines(), ["kl-1"]);
    assert.deepEqual(store.getMicronemes(), [0.5]);
  });

  it("snapshot() reflects all fields simultaneously", () => {
    const store = new ContextStore();
    store.bind("Actor", "find-agent");
    store.bind("Goal", "tower-summit");
    store.setFrame("tower-construction");
    store.setActiveKLines(["kl-abc", "kl-def"]);
    store.setMicronemes([0.1, 0.2]);

    const snap = store.snapshot();
    assert.equal(snap.pronomes["Actor"], "find-agent");
    assert.equal(snap.pronomes["Goal"], "tower-summit");
    assert.equal(snap.frame_id, "tower-construction");
    assert.deepEqual(snap.kline_ids, ["kl-abc", "kl-def"]);
    assert.deepEqual(snap.micronemes, [0.1, 0.2]);
  });
});

// ─── PolynemeBus + ContextStore integration tests ────────────────────────────

let tmpDir: string;
let log: EventLog;

before(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "som-ctx-test-"));
  log = EventLog.open(join(tmpDir, "test.db"));
});

after(async () => {
  log.close();
  await rm(tmpDir, { recursive: true });
});

const flush = () => new Promise((r) => setTimeout(r, 10));

describe("PolynemeBus + ContextStore integration", () => {
  it("emitted signals carry frame_id from ContextStore", async () => {
    const store = new ContextStore();
    const bus = new PolynemeBus(log, store);
    const received: Array<{ frame_id: string | null }> = [];

    bus.subscribe({
      id: "frame-spy",
      signals: ["test.frame"],
      onSignal: (e) => received.push({ frame_id: e.context.frame_id }),
    });

    store.setFrame("block-placement-frame");
    bus.emit({ source: "test", signal: "test.frame", type: "polyneme", payload: {}, causedBy: null });
    await flush();

    assert.equal(received.length, 1);
    assert.equal(received[0].frame_id, "block-placement-frame");

    bus.unsubscribe("frame-spy");
  });

  it("emitted signals carry kline_ids from ContextStore", async () => {
    const store = new ContextStore();
    const bus = new PolynemeBus(log, store);
    const received: string[][] = [];

    bus.subscribe({
      id: "kline-spy",
      signals: ["test.kline"],
      onSignal: (e) => received.push(e.context.kline_ids),
    });

    store.setActiveKLines(["kl-001", "kl-002"]);
    bus.emit({ source: "test", signal: "test.kline", type: "polyneme", payload: {}, causedBy: null });
    await flush();

    assert.deepEqual(received[0], ["kl-001", "kl-002"]);

    bus.unsubscribe("kline-spy");
  });

  it("caller-provided context overrides ContextStore snapshot", async () => {
    const store = new ContextStore();
    const bus = new PolynemeBus(log, store);
    const received: Array<{ frame_id: string | null; pronomes: Record<string, string> }> = [];

    bus.subscribe({
      id: "override-spy",
      signals: ["test.override"],
      onSignal: (e) => received.push({ frame_id: e.context.frame_id, pronomes: e.context.pronomes }),
    });

    store.setFrame("default-frame");
    store.bind("Actor", "default-agent");

    bus.emit({
      source:   "test",
      signal:   "test.override",
      type:     "polyneme",
      payload:  {},
      causedBy: null,
      context:  {
        frame_id:   "specific-frame",         // overrides store
        pronomes:   { Actor: "specific-agent" }, // overrides store
        kline_ids:  [],
        micronemes: [],
      },
    });
    await flush();

    assert.equal(received[0].frame_id, "specific-frame");
    assert.equal(received[0].pronomes["Actor"], "specific-agent");

    bus.unsubscribe("override-spy");
  });

  it("pronome.release emits an audit event with role and agentId", async () => {
    const bus = new PolynemeBus(log);
    const releases: Array<{ role: string; agentId: string | null }> = [];

    bus.subscribe({
      id: "release-spy",
      signals: ["pronome.release"],
      onSignal: (e) => releases.push({
        role:    e.payload["role"] as string,
        agentId: e.payload["agentId"] as string | null,
      }),
    });

    bus.bindPronome("Director", "director-agent-01");
    bus.releasePronome("Director");
    await flush();

    assert.equal(releases.length, 1);
    assert.equal(releases[0].role, "Director");
    assert.equal(releases[0].agentId, "director-agent-01");

    bus.unsubscribe("release-spy");
  });

  it("ContextStore injected into bus is the same instance (accessible externally)", () => {
    const store = new ContextStore();
    const bus = new PolynemeBus(log, store);
    store.setFrame("injected-frame");
    assert.equal(bus.context.getFrame(), "injected-frame");
  });
});
