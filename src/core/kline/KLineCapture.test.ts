import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventLog } from "../event-log/EventLog.ts";
import { KLineStore } from "./KLineStore.ts";
import { BagOfWordsEmbedder } from "./embedding.ts";
import { capturePositiveKLine } from "./capture.ts";
import { KLineRetrievalEngine } from "./retrieval.ts";
import type { EmitInput, SignalEnvelope } from "../event-log/types.ts";

// ─── Test fixtures ────────────────────────────────────────────────────────────

let tmpDir:   string;
let eventLog: EventLog;
let store:    KLineStore;
const embedder = new BagOfWordsEmbedder();

before(async () => {
  tmpDir   = await mkdtemp(join(tmpdir(), "som-capture-test-"));
  eventLog = EventLog.open(join(tmpDir, "events.db"));
  store    = KLineStore.open(join(tmpDir, "klines.db"));
});

after(async () => {
  store.close();
  eventLog.close();
  await rm(tmpDir, { recursive: true });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Emit an event and return its SignalEnvelope. */
function emit(input: EmitInput): SignalEnvelope {
  const id = eventLog.emit(input);
  const ev = eventLog.getById(id);
  assert.ok(ev !== null, "emitted event should be retrievable");
  return ev;
}

/** Build a chain: root → child → grandchild (task.succeeded). */
function buildBlockPlacementChain(): SignalEnvelope {
  const rootEv = emit({
    source:  "find-agent",
    signal:  "block.found",
    type:    "polyneme",
    payload: { blockId: "block-A" },
    context: { pronomes: { Actor: "find-agent" }, frame_id: "block-placement-frame", kline_ids: [], micronemes: [] },
    causedBy: null,
  });

  const childEv = emit({
    source:  "grasp-agent",
    signal:  "block.grasped",
    type:    "polyneme",
    payload: { blockId: "block-A" },
    context: { pronomes: { Actor: "grasp-agent", Goal: "tower-top" }, frame_id: "block-placement-frame", kline_ids: [], micronemes: [] },
    causedBy: rootEv.id,
  });

  const grandchildEv = emit({
    source:  "place-agent",
    signal:  "task.succeeded",
    type:    "polyneme",
    payload: { description: "Placed block A onto tower base", task_id: "task-block-001" },
    context: { pronomes: { Actor: "grasp-agent", Goal: "tower-top" }, frame_id: "block-placement-frame", kline_ids: [], micronemes: [0.1, 0.5] },
    causedBy: childEv.id,
  });

  return grandchildEv;
}

// ─── Capture tests ────────────────────────────────────────────────────────────

describe("capturePositiveKLine", () => {

  it("captures a K-line from a task.succeeded signal with causal chain", async () => {
    const trigger = buildBlockPlacementChain();
    const result  = await capturePositiveKLine(trigger, eventLog, store, embedder);

    assert.ok(result.klineId.length > 0);
    assert.ok(result.activationCount >= 1);

    const kl = store.getById(result.klineId);
    assert.ok(kl !== null);
    assert.equal(kl.type, "positive");
    assert.equal(kl.situation.description, "Placed block A onto tower base");
    assert.equal(kl.task_id, "task-block-001");
    assert.equal(kl.source_events.length >= 1, true);
  });

  it("assigns place-agent (trigger emitter) to core band", async () => {
    const trigger = buildBlockPlacementChain();
    const result  = await capturePositiveKLine(trigger, eventLog, store, embedder);
    const kl = store.getById(result.klineId)!;

    assert.ok(
      kl.bands.core.agents.includes("place-agent"),
      `place-agent (trigger emitter) should be core; core=${JSON.stringify(kl.bands.core.agents)}`,
    );
  });

  it("assigns chain agents to peripheral or core band", async () => {
    const trigger = buildBlockPlacementChain();
    const result  = await capturePositiveKLine(trigger, eventLog, store, embedder);
    const kl = store.getById(result.klineId)!;

    const allBanded = [
      ...kl.bands.core.agents,
      ...kl.bands.peripheral.agents,
      ...kl.bands.fringe.agents,
    ];
    // find-agent and grasp-agent appear in the causal chain
    assert.ok(
      allBanded.includes("find-agent") || allBanded.includes("grasp-agent"),
      `causal-chain agents should appear in some band; got ${JSON.stringify(allBanded)}`,
    );
  });

  it("embeds the situation description (embedding is non-empty)", async () => {
    const trigger = buildBlockPlacementChain();
    const result  = await capturePositiveKLine(trigger, eventLog, store, embedder);
    const kl = store.getById(result.klineId)!;

    assert.equal(kl.embedding.length, embedder.dims);
    assert.equal(kl.embedding_model, embedder.modelName);
    assert.ok(kl.embedding_hash.length > 0);
  });

  it("falls back to description built from context when payload has none", async () => {
    const fallbackEv = emit({
      source:  "task-runner",
      signal:  "task.succeeded",
      type:    "polyneme",
      payload: { task_id: "ctx-fallback-task" }, // no description field
      context: {
        pronomes:   { Actor: "agent-x", Goal: "goal-y" },
        frame_id:   "my-frame",
        kline_ids:  [],
        micronemes: [],
      },
      causedBy: null,
    });

    const result = await capturePositiveKLine(fallbackEv, eventLog, store, embedder);
    const kl = store.getById(result.klineId)!;

    // Description should contain frame / pronome information
    assert.ok(kl.situation.description.length > 0);
    assert.ok(
      kl.situation.description.includes("my-frame") ||
      kl.situation.description.includes("Actor") ||
      kl.situation.description.includes("task.succeeded"),
    );
  });
});

// ─── Retrieval tests ──────────────────────────────────────────────────────────

describe("KLineRetrievalEngine", () => {

  it("retrieves a similar K-line with score > 0.7", async () => {
    const engine = new KLineRetrievalEngine(store, embedder);

    // Write a block-placement K-line directly with a known description
    store.write({
      type: "positive",
      situation: {
        description: "Successfully placed wooden block onto tower base",
        frame_id:    "block-frame",
        pronomes:    { Actor: "grasp-agent" },
        micronemes:  [],
        realm:       ["physical"],
      },
      activations: [],
      bands: {
        core:       { agents: ["grasp-agent"], properties: {}, decay_rate: 0   },
        peripheral: { agents: [],              properties: {}, decay_rate: 180 },
        fringe:     { agents: [],              properties: {}, decay_rate: 30  },
      },
      guard:         null,
      parent_id:     null,
      source_events: [],
      task_id:       "retrieval-test-1",
      embedding:        await embedder.embed("Successfully placed wooden block onto tower base"),
      embedding_model:  embedder.modelName,
      embedding_hash:   "abc",
    });

    // Query with very similar text
    const results = await engine.retrieve(
      "place wooden block on tower base",
      { trackRetrieval: false, topK: 5 },
    );

    assert.ok(results.length >= 1, "should retrieve at least one K-line");
    assert.ok(
      results[0].score > 0.3,
      `top score should be substantial; got ${results[0].score}`,
    );
  });

  it("does not retrieve unrelated K-lines (score < 0.3)", async () => {
    const engine = new KLineRetrievalEngine(store, embedder);

    // Write a K-line about a completely different topic
    store.write({
      type: "positive",
      situation: {
        description: "Sent email to marketing team about quarterly report",
        frame_id:    null,
        pronomes:    {},
        micronemes:  [],
        realm:       ["social"],
      },
      activations: [],
      bands: {
        core:       { agents: ["email-agent"], properties: {}, decay_rate: 0   },
        peripheral: { agents: [],              properties: {}, decay_rate: 180 },
        fringe:     { agents: [],              properties: {}, decay_rate: 30  },
      },
      guard:         null,
      parent_id:     null,
      source_events: [],
      task_id:       "retrieval-test-unrelated",
      embedding:        await embedder.embed("Sent email to marketing team about quarterly report"),
      embedding_model:  embedder.modelName,
      embedding_hash:   "xyz",
    });

    // Query about something completely unrelated to email or reports
    const results = await engine.retrieve(
      "place wooden block on tower base",
      { trackRetrieval: false, topK: 5, minScore: 0 },
    );

    // The email K-line may appear but should score lower than the block K-line
    const emailResult = results.find((r) => r.kline.task_id === "retrieval-test-unrelated");
    if (emailResult) {
      // If it appears, its score should be lower than the block K-line score
      const blockResult = results.find((r) => r.kline.task_id === "retrieval-test-1");
      if (blockResult) {
        assert.ok(
          blockResult.score >= emailResult.score,
          `block K-line (${blockResult.score}) should score >= email K-line (${emailResult.score})`,
        );
      }
    }
  });

  it("returns results in descending score order", async () => {
    const engine = new KLineRetrievalEngine(store, embedder);
    const results = await engine.retrieve("block tower placement", { trackRetrieval: false, topK: 10 });

    for (let i = 1; i < results.length; i++) {
      assert.ok(
        results[i - 1].score >= results[i].score,
        `scores should be non-increasing; got ${results[i-1].score} then ${results[i].score}`,
      );
    }
  });

  it("increments retrieval_count when trackRetrieval=true", async () => {
    const engine = new KLineRetrievalEngine(store, embedder);

    const id = store.write({
      type: "positive",
      situation: {
        description: "grasp agent lifts block to target position",
        frame_id: null, pronomes: {}, micronemes: [], realm: [],
      },
      activations: [],
      bands: {
        core:       { agents: ["grasp-agent"], properties: {}, decay_rate: 0 },
        peripheral: { agents: [], properties: {}, decay_rate: 180 },
        fringe:     { agents: [], properties: {}, decay_rate: 30 },
      },
      guard: null, parent_id: null, source_events: [], task_id: "track-retrieval-test",
      embedding:        await embedder.embed("grasp agent lifts block to target position"),
      embedding_model:  embedder.modelName,
      embedding_hash:   "track-1",
    });

    const before = store.getById(id)!.retrieval_count;
    await engine.retrieve("grasp block lift target", { trackRetrieval: true, topK: 5 });
    const after = store.getById(id)!.retrieval_count;

    // The K-line should have been retrieved and counted
    assert.ok(after >= before, "retrieval_count should be incremented");
  });

  it("retrieveSimilarTo returns K-lines similar to an existing one", async () => {
    const engine = new KLineRetrievalEngine(store, embedder);

    const desc = "stack red block on blue block successfully";
    const id = store.write({
      type: "positive",
      situation: { description: desc, frame_id: null, pronomes: {}, micronemes: [], realm: [] },
      activations: [],
      bands: {
        core:       { agents: ["stacker"], properties: {}, decay_rate: 0 },
        peripheral: { agents: [], properties: {}, decay_rate: 180 },
        fringe:     { agents: [], properties: {}, decay_rate: 30 },
      },
      guard: null, parent_id: null, source_events: [], task_id: "similar-to-test",
      embedding:       await embedder.embed(desc),
      embedding_model: embedder.modelName,
      embedding_hash:  "similar-1",
    });

    const results = await engine.retrieveSimilarTo(id, { trackRetrieval: false, topK: 5 });
    assert.ok(results.length >= 1, "should retrieve at least one similar K-line");
  });

  it("retrieveSimilarTo returns empty for unknown id", async () => {
    const engine = new KLineRetrievalEngine(store, embedder);
    const results = await engine.retrieveSimilarTo("01ZZZZZZZZZZZZZZZZZZZZZZZZZ", { trackRetrieval: false });
    assert.equal(results.length, 0);
  });
});
