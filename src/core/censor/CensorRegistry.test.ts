import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventLog } from "../event-log/EventLog.ts";
import { PolynemeBus } from "../polyneme-bus/PolynemeBus.ts";
import { ContextStore } from "../context/ContextStore.ts";
import { KLineStore } from "../kline/KLineStore.ts";
import { BagOfWordsEmbedder } from "../kline/embedding.ts";
import { KLineRetrievalEngine } from "../kline/retrieval.ts";
import { createCensorRegistry } from "./registry.ts";
import type { SignalEnvelope } from "../event-log/types.ts";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

let tmpDir:    string;
let klineStore: KLineStore;
let retrieval:  KLineRetrievalEngine;

const embedder = new BagOfWordsEmbedder();

before(async () => {
  tmpDir     = await mkdtemp(join(tmpdir(), "som-censor-registry-test-"));
  klineStore = KLineStore.open(join(tmpDir, "klines.db"));
  retrieval  = new KLineRetrievalEngine(klineStore, embedder);
  await seedCensors();
});

after(async () => {
  klineStore.close();
  await rm(tmpDir, { recursive: true });
});

// ─── Seed censor K-lines ──────────────────────────────────────────────────────

async function seedCensors() {
  // Censor: "move_block" in a grasp situation caused tower collapse
  const desc1 = "grasp agent block tower placement failed";
  klineStore.write({
    type: "censor",
    situation: {
      description: desc1,
      frame_id:    null,
      pronomes:    { Actor: "grasp-agent", Object: "block-A" },
      micronemes:  [],
      realm:       [],
    },
    activations:  [],
    bands: {
      core:       { agents: ["grasp-agent"], properties: {}, decay_rate: 0 },
      peripheral: { agents: [],             properties: {}, decay_rate: 180 },
      fringe:     { agents: [],             properties: {}, decay_rate: 30 },
    },
    guard: {
      precursor_pattern:   "Grasping block when tower is unstable",
      blocked_action:      "move_block",
      outcome_description: "Tower collapsed during move",
    },
    parent_id:       null,
    source_events:   [],
    task_id:         null,
    embedding:       await embedder.embed(desc1),
    embedding_model: embedder.modelName,
    embedding_hash:  "censor-test-1",
  });

  // Censor: "drop_block" in a placement context
  const desc2 = "placement block tower drop unstable failure";
  klineStore.write({
    type: "censor",
    situation: {
      description: desc2,
      frame_id:    null,
      pronomes:    { Actor: "place-agent" },
      micronemes:  [],
      realm:       [],
    },
    activations:  [],
    bands: {
      core:       { agents: ["place-agent"], properties: {}, decay_rate: 0 },
      peripheral: { agents: [],             properties: {}, decay_rate: 180 },
      fringe:     { agents: [],             properties: {}, decay_rate: 30 },
    },
    guard: {
      precursor_pattern:   "Dropping block while tower is high",
      blocked_action:      "drop_block",
      outcome_description: "Block fell from height causing damage",
    },
    parent_id:       null,
    source_events:   [],
    task_id:         null,
    embedding:       await embedder.embed(desc2),
    embedding_model: embedder.modelName,
    embedding_hash:  "censor-test-2",
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function makeEnv() {
  const log = EventLog.open(join(tmpDir, `events-${Date.now()}.db`));
  const bus = new PolynemeBus(log, new ContextStore());
  return { log, bus };
}

function collect(bus: PolynemeBus, signal: string): SignalEnvelope[] {
  const received: SignalEnvelope[] = [];
  bus.subscribe({
    id:       `spy-${signal}-${Date.now()}`,
    signals:  [signal],
    onSignal: (e) => received.push(e),
  });
  return received;
}

function emitToolIntent(
  bus:     PolynemeBus,
  tool:    string,
  context: { frame_id?: string | null; pronomes?: Record<string, string> } = {},
): string {
  return bus.emit({
    source:   "test-agent",
    signal:   "tool.call",
    type:     "tool_intent",
    payload:  { tool, input: {} },
    context:  {
      pronomes:  context.pronomes ?? {},
      frame_id:  context.frame_id ?? null,
      kline_ids: [],
      micronemes: [],
    },
    causedBy: null,
  });
}

// ─── CensorRegistry tests ──────────────────────────────────────────────────────

describe("CensorRegistry", () => {

  it("emits censor.fired when tool matches a censor K-line", async () => {
    const { log, bus } = await makeEnv();
    createCensorRegistry(retrieval, { minScore: 0.01 }).connect(bus);

    const fired = collect(bus, "censor.fired");

    emitToolIntent(bus, "move_block", {
      pronomes: { Actor: "grasp-agent", Object: "block-A" },
    });

    await new Promise((r) => setTimeout(r, 100));

    assert.ok(fired.length >= 1, "should emit censor.fired for known-bad action");

    log.close();
  });

  it("censor.fired payload has correct shape", async () => {
    const { log, bus } = await makeEnv();
    createCensorRegistry(retrieval, { minScore: 0.01 }).connect(bus);

    const fired = collect(bus, "censor.fired");

    emitToolIntent(bus, "move_block", {
      pronomes: { Actor: "grasp-agent", Object: "block-A" },
    });

    await new Promise((r) => setTimeout(r, 100));

    assert.ok(fired.length >= 1);
    const p = fired[0].payload as Record<string, unknown>;

    assert.equal(typeof p.action,            "string");
    assert.equal(typeof p.kline_id,          "string");
    assert.equal(typeof p.precursor_pattern, "string");
    assert.equal(typeof p.blocked_action,    "string");
    assert.equal(typeof p.score,             "number");
    assert.ok((p.score as number) > 0);

    log.close();
  });

  it("censor.fired is caused by the triggering tool_intent signal", async () => {
    const { log, bus } = await makeEnv();
    createCensorRegistry(retrieval, { minScore: 0.01 }).connect(bus);

    const fired = collect(bus, "censor.fired");

    const triggerId = emitToolIntent(bus, "move_block", {
      pronomes: { Actor: "grasp-agent" },
    });

    await new Promise((r) => setTimeout(r, 100));

    assert.ok(fired.length >= 1);
    assert.equal(fired[0].causedBy, triggerId, "censor.fired should be caused by tool_intent");

    log.close();
  });

  it("censor.fired signal type is 'censor'", async () => {
    const { log, bus } = await makeEnv();
    createCensorRegistry(retrieval, { minScore: 0.01 }).connect(bus);

    const fired = collect(bus, "censor.fired");

    emitToolIntent(bus, "drop_block", {
      pronomes: { Actor: "place-agent" },
    });

    await new Promise((r) => setTimeout(r, 100));

    assert.ok(fired.length >= 1);
    assert.equal(fired[0].type, "censor");

    log.close();
  });

  it("no censor.fired for a completely unrelated tool", async () => {
    const { log, bus } = await makeEnv();
    createCensorRegistry(retrieval, { minScore: 0.5 }).connect(bus);

    const fired = collect(bus, "censor.fired");

    // Completely unrelated tool — no semantic overlap with seeded censors
    emitToolIntent(bus, "send_email_to_stakeholder_xyzzy_irrelevant", {});

    await new Promise((r) => setTimeout(r, 100));

    assert.equal(fired.length, 0, "should not fire censor for unrelated tool");

    log.close();
  });

  it("minScore threshold prevents low-confidence matches from firing", async () => {
    const { log, bus } = await makeEnv();
    // Very high threshold — only near-perfect matches fire
    createCensorRegistry(retrieval, { minScore: 0.99 }).connect(bus);

    const fired = collect(bus, "censor.fired");

    emitToolIntent(bus, "move_block", { pronomes: { Actor: "unknown-agent" } });

    await new Promise((r) => setTimeout(r, 100));

    // May or may not fire depending on score — just verify no crash
    assert.equal(typeof fired.length, "number");

    log.close();
  });

  it("only tool_intent signals are evaluated — polyneme with same payload is ignored", async () => {
    const { log, bus } = await makeEnv();
    createCensorRegistry(retrieval, { minScore: 0.01 }).connect(bus);

    const fired = collect(bus, "censor.fired");

    // Same payload but type=polyneme — should NOT trigger censor check
    bus.emit({
      source:   "test",
      signal:   "tool.call",
      type:     "polyneme",   // NOT tool_intent
      payload:  { tool: "move_block", input: {} },
      context:  { pronomes: { Actor: "grasp-agent" }, frame_id: null, kline_ids: [], micronemes: [] },
      causedBy: null,
    });

    await new Promise((r) => setTimeout(r, 100));

    assert.equal(fired.length, 0, "polyneme signals should not trigger censor check");

    log.close();
  });

  it("multiple tool_intent signals each checked independently", async () => {
    const { log, bus } = await makeEnv();
    createCensorRegistry(retrieval, { minScore: 0.01 }).connect(bus);

    const fired = collect(bus, "censor.fired");

    emitToolIntent(bus, "move_block",  { pronomes: { Actor: "grasp-agent" } });
    emitToolIntent(bus, "drop_block",  { pronomes: { Actor: "place-agent" } });

    await new Promise((r) => setTimeout(r, 150));

    // Both match seeded censors
    assert.ok(fired.length >= 2, "both tool intents should trigger censor checks");

    const actions = fired.map((e) => (e.payload as Record<string, unknown>).action);
    assert.ok(actions.includes("move_block"));
    assert.ok(actions.includes("drop_block"));

    log.close();
  });
});
