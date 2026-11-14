import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventLog } from "../event-log/EventLog.ts";
import { KLineStore } from "./KLineStore.ts";
import { BagOfWordsEmbedder } from "./embedding.ts";
import { captureCensorKLine } from "./censor.ts";
import { KLineRetrievalEngine } from "./retrieval.ts";
import type { EmitInput, SignalEnvelope } from "../event-log/types.ts";

// ─── Test fixtures ────────────────────────────────────────────────────────────

let tmpDir:   string;
let eventLog: EventLog;
let store:    KLineStore;
const embedder = new BagOfWordsEmbedder();

before(async () => {
  tmpDir   = await mkdtemp(join(tmpdir(), "som-censor-test-"));
  eventLog = EventLog.open(join(tmpDir, "events.db"));
  store    = KLineStore.open(join(tmpDir, "klines.db"));
});

after(async () => {
  store.close();
  eventLog.close();
  await rm(tmpDir, { recursive: true });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function emit(input: EmitInput): SignalEnvelope {
  const id = eventLog.emit(input);
  const ev = eventLog.getById(id);
  assert.ok(ev !== null);
  return ev;
}

/** Build a failure chain: setup → bad_action (tool_intent) → task.failed */
function buildFailureChain(opts: {
  blockedAction?: string;
  reason?: string;
  frameId?: string;
} = {}): SignalEnvelope {
  const setup = emit({
    source:  "find-agent",
    signal:  "block.found",
    type:    "polyneme",
    payload: { blockId: "block-B" },
    context: {
      pronomes: { Actor: "find-agent" },
      frame_id: opts.frameId ?? "block-placement-frame",
      kline_ids: [], micronemes: [],
    },
    causedBy: null,
  });

  const badAction = emit({
    source:  "grasp-agent",
    signal:  "grasp_block",
    type:    "tool_intent",
    payload: { tool: opts.blockedAction ?? "grasp_block", blockId: "block-B" },
    context: {
      pronomes: { Actor: "grasp-agent" },
      frame_id: opts.frameId ?? "block-placement-frame",
      kline_ids: [], micronemes: [],
    },
    causedBy: setup.id,
  });

  const failure = emit({
    source:  "task-runner",
    signal:  "task.failed",
    type:    "polyneme",
    payload: {
      reason:  opts.reason ?? "Block B is load-bearing — tower collapsed",
      task_id: "task-fail-001",
    },
    context: {
      pronomes: { Actor: "grasp-agent", Goal: "tower-top" },
      frame_id: opts.frameId ?? "block-placement-frame",
      kline_ids: [], micronemes: [],
    },
    causedBy: badAction.id,
  });

  return failure;
}

// ─── Capture tests ────────────────────────────────────────────────────────────

describe("captureCensorKLine", () => {

  it("captures a censor K-line from a task.failed signal", async () => {
    const trigger = buildFailureChain();
    const result  = await captureCensorKLine(trigger, eventLog, store, embedder);

    assert.ok(result.klineId.length > 0);
    const kl = store.getById(result.klineId);
    assert.ok(kl !== null);
    assert.equal(kl.type, "censor");
  });

  it("guard.blocked_action is extracted from tool_intent in chain", async () => {
    const trigger = buildFailureChain({ blockedAction: "grasp_block" });
    const result  = await captureCensorKLine(trigger, eventLog, store, embedder);
    const kl = store.getById(result.klineId)!;

    assert.ok(kl.guard !== null);
    assert.equal(kl.guard.blocked_action, "grasp_block");
  });

  it("guard.blocked_action falls back to payload.blocked_action if present", async () => {
    const trigger = emit({
      source:  "task-runner",
      signal:  "task.failed",
      type:    "polyneme",
      payload: { blocked_action: "push_block", reason: "Would destabilise tower" },
      context: { pronomes: {}, frame_id: null, kline_ids: [], micronemes: [] },
      causedBy: null,
    });

    const result = await captureCensorKLine(trigger, eventLog, store, embedder);
    const kl = store.getById(result.klineId)!;
    assert.equal(kl.guard?.blocked_action, "push_block");
  });

  it("guard.outcome_description extracted from payload.reason", async () => {
    const trigger = buildFailureChain({ reason: "Tower would topple" });
    const result  = await captureCensorKLine(trigger, eventLog, store, embedder);
    const kl = store.getById(result.klineId)!;

    assert.ok(kl.guard !== null);
    assert.ok(kl.guard.outcome_description.includes("Tower would topple"));
  });

  it("guard.precursor_pattern includes frame and failure signal", async () => {
    const trigger = buildFailureChain({ frameId: "unique-failure-frame" });
    const result  = await captureCensorKLine(trigger, eventLog, store, embedder);
    const kl = store.getById(result.klineId)!;

    assert.ok(kl.guard !== null);
    assert.ok(
      kl.guard.precursor_pattern.includes("unique-failure-frame") ||
      kl.guard.precursor_pattern.includes("task.failed"),
      `precursor should reference context; got: ${kl.guard.precursor_pattern}`,
    );
  });

  it("failure emitter is assigned to core band", async () => {
    const trigger = buildFailureChain();
    const result  = await captureCensorKLine(trigger, eventLog, store, embedder);
    const kl = store.getById(result.klineId)!;

    assert.ok(
      kl.bands.core.agents.includes("task-runner"),
      `task-runner (failure emitter) should be core; got ${JSON.stringify(kl.bands.core.agents)}`,
    );
  });

  it("embedding is populated with correct model", async () => {
    const trigger = buildFailureChain();
    const result  = await captureCensorKLine(trigger, eventLog, store, embedder);
    const kl = store.getById(result.klineId)!;

    assert.equal(kl.embedding.length, embedder.dims);
    assert.equal(kl.embedding_model, embedder.modelName);
    assert.ok(kl.embedding_hash.length > 0);
  });

  it("task_id is propagated from payload", async () => {
    const trigger = buildFailureChain();
    const result  = await captureCensorKLine(trigger, eventLog, store, embedder);
    const kl = store.getById(result.klineId)!;
    assert.equal(kl.task_id, "task-fail-001");
  });
});

// ─── Retrieval tests ──────────────────────────────────────────────────────────

describe("KLineRetrievalEngine.retrieveCensors", () => {

  it("returns a censor K-line when situation and action match", async () => {
    const engine = new KLineRetrievalEngine(store, embedder);

    // Write a censor directly with a known description + blocked_action
    const desc = "Agent attempts to grasp load-bearing block in tower frame";
    store.write({
      type: "censor",
      situation: {
        description: desc,
        frame_id:    "block-placement-frame",
        pronomes:    { Actor: "grasp-agent" },
        micronemes:  [],
        realm:       [],
      },
      activations: [],
      bands: {
        core:       { agents: ["grasp-agent"], properties: {}, decay_rate: 0 },
        peripheral: { agents: [], properties: {}, decay_rate: 180 },
        fringe:     { agents: [], properties: {}, decay_rate: 30 },
      },
      guard: {
        precursor_pattern:   desc,
        blocked_action:      "grasp_block",
        outcome_description: "Tower collapsed",
      },
      parent_id: null, source_events: [], task_id: "censor-retrieval-test",
      embedding:       await embedder.embed(desc),
      embedding_model: embedder.modelName,
      embedding_hash:  "censor-1",
    });

    const results = await engine.retrieveCensors(
      "grasp load-bearing block tower",
      "grasp_block",
    );

    assert.ok(results.length >= 1, "should find the matching censor");
    assert.equal(results[0].kline.type, "censor");
    assert.equal(results[0].kline.guard?.blocked_action, "grasp_block");
  });

  it("does not return censors for a different action", async () => {
    const engine = new KLineRetrievalEngine(store, embedder);

    const results = await engine.retrieveCensors(
      "grasp load-bearing block tower",
      "push_block",  // different from grasp_block
    );

    // None of the results should have blocked_action matching "push_block"
    for (const { kline } of results) {
      const blocked = kline.guard?.blocked_action.toLowerCase() ?? "";
      assert.ok(
        blocked.includes("push_block") || results.length === 0,
        `unexpected censor match for push_block: ${blocked}`,
      );
    }
  });

  it("typeFilter=censor excludes positive K-lines from results", async () => {
    const engine = new KLineRetrievalEngine(store, embedder);

    // Write a positive K-line with similar description
    store.write({
      type: "positive",
      situation: {
        description: "grasp block successfully placed on tower",
        frame_id: null, pronomes: {}, micronemes: [], realm: [],
      },
      activations: [],
      bands: {
        core: { agents: [], properties: {}, decay_rate: 0 },
        peripheral: { agents: [], properties: {}, decay_rate: 180 },
        fringe: { agents: [], properties: {}, decay_rate: 30 },
      },
      guard: null, parent_id: null, source_events: [], task_id: "positive-filter-test",
      embedding:       await embedder.embed("grasp block successfully placed on tower"),
      embedding_model: embedder.modelName,
      embedding_hash:  "pos-1",
    });

    // retrieveCensors should only return censor type
    const results = await engine.retrieveCensors("grasp block tower", "grasp_block");
    for (const { kline } of results) {
      assert.equal(kline.type, "censor", `should only return censor K-lines; got ${kline.type}`);
    }
  });
});

// ─── CENSOR_CHECK query integration ──────────────────────────────────────────

describe("QueryEngine CENSOR_CHECK", () => {

  it("returns wouldFire=false with stub=true when no retrieval engine", async () => {
    const { QueryEngine } = await import("../query/QueryEngine.ts");
    const { EventLog: EL } = await import("../event-log/EventLog.ts");
    const { PolynemeBus } = await import("../polyneme-bus/PolynemeBus.ts");

    const tmpDb = join(tmpDir, "qe-events.db");
    const log2  = EL.open(tmpDb);
    const bus2  = new PolynemeBus(log2);
    const qe    = new QueryEngine(log2, bus2); // no retrieval engine

    const result = await qe.query({
      type:      "CENSOR_CHECK",
      agentId:   "grasp-agent",
      action:    "grasp_block",
      situation: "tower frame load-bearing block",
    });

    assert.equal(result.type, "CENSOR_CHECK");
    if (result.type === "CENSOR_CHECK") {
      assert.equal(result.wouldFire, false);
      assert.equal(result.stub, true);
    }

    log2.close();
  });

  it("returns wouldFire=true when a matching censor exists", async () => {
    const { QueryEngine } = await import("../query/QueryEngine.ts");
    const { EventLog: EL } = await import("../event-log/EventLog.ts");
    const { PolynemeBus } = await import("../polyneme-bus/PolynemeBus.ts");

    const tmpDb   = join(tmpDir, "qe-events2.db");
    const tmpKDb  = join(tmpDir, "qe-klines2.db");
    const log3    = EL.open(tmpDb);
    const store3  = KLineStore.open(tmpKDb);
    const bus3    = new PolynemeBus(log3);
    const engine  = new KLineRetrievalEngine(store3, embedder);
    const qe      = new QueryEngine(log3, bus3, engine);

    // Write a censor K-line
    const desc = "tower frame agent grasping load-bearing block";
    store3.write({
      type: "censor",
      situation: { description: desc, frame_id: null, pronomes: {}, micronemes: [], realm: [] },
      activations: [],
      bands: {
        core: { agents: [], properties: {}, decay_rate: 0 },
        peripheral: { agents: [], properties: {}, decay_rate: 180 },
        fringe: { agents: [], properties: {}, decay_rate: 30 },
      },
      guard: {
        precursor_pattern:   desc,
        blocked_action:      "grasp_block",
        outcome_description: "Tower collapsed",
      },
      parent_id: null, source_events: [], task_id: "qe-censor-test",
      embedding:       await embedder.embed(desc),
      embedding_model: embedder.modelName,
      embedding_hash:  "qe-censor-1",
    });

    const result = await qe.query({
      type:      "CENSOR_CHECK",
      agentId:   "grasp-agent",
      action:    "grasp_block",
      situation: "tower frame load-bearing block grasping",
    });

    assert.equal(result.type, "CENSOR_CHECK");
    if (result.type === "CENSOR_CHECK") {
      assert.equal(result.stub, false);
      assert.ok(result.wouldFire, "should fire when situation + action match a censor");
      assert.ok(result.matchingCensors.length >= 1);
    }

    store3.close();
    log3.close();
  });
});
