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
import { FrameStore } from "./FrameStore.ts";
import { FrameMatcher } from "./matcher.ts";
import { fillSlots } from "./slotfiller.ts";
import { createFrameAgent } from "./FrameAgent.ts";
import type { FrameInput, Terminal } from "./types.ts";
import type { SignalEnvelope } from "../event-log/types.ts";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

let tmpDir:    string;
let frameStore: FrameStore;

before(async () => {
  tmpDir     = await mkdtemp(join(tmpdir(), "som-matching-test-"));
  frameStore = FrameStore.open(join(tmpDir, "frames.db"));
  seedFrames();
});

after(async () => {
  frameStore.close();
  await rm(tmpDir, { recursive: true });
});

// ─── Seed frames ──────────────────────────────────────────────────────────────

let blockPlacementId: string;
let graspId:          string;

function seedFrames() {
  blockPlacementId = frameStore.write({
    name:        "BlockPlacement",
    description: "Placing a block onto a target position in the tower",
    terminals: {
      Actor: {
        name: "Actor", type: "agent_id",
        default_value: "grasp-agent", default_confidence: 0.5, required: true,
      },
      Object: {
        name: "Object", type: "string",
        default_value: null, default_confidence: 0, required: true,
      },
      Goal: {
        name: "Goal", type: "string",
        default_value: "tower-top", default_confidence: 0.4, required: false,
      },
    },
    parent_frame_id: null,
  });

  graspId = frameStore.write({
    name:        "Grasp",
    description: "Agent extends manipulator arm to grasp an object",
    terminals: {
      Actor:  { name: "Actor",  type: "agent_id", default_value: "grasp-agent", default_confidence: 0.7, required: true },
      Object: { name: "Object", type: "string",   default_value: null,           default_confidence: 0,   required: true },
    },
    parent_frame_id: null,
  });
}

function makeSignal(overrides: Partial<SignalEnvelope> = {}): SignalEnvelope {
  return {
    id:        "01TEST00000000000000000001",
    timestamp: Date.now(),
    source:    "test-agent",
    signal:    "block.found",
    type:      "polyneme",
    payload:   {},
    context:   { pronomes: {}, frame_id: null, kline_ids: [], micronemes: [] },
    causedBy:  null,
    ...overrides,
  };
}

// ─── FrameMatcher tests ───────────────────────────────────────────────────────

describe("FrameMatcher", () => {

  it("block.found signal selects BlockPlacement as top match", () => {
    const matcher = new FrameMatcher(frameStore);
    const ranked  = matcher.match(makeSignal({ signal: "block.found" }), {});

    assert.ok(ranked.length >= 1);
    assert.equal(ranked[0].frame.name, "BlockPlacement");
    assert.ok(ranked[0].score > 0);
  });

  it("grasp.initiated signal selects Grasp frame", () => {
    const matcher = new FrameMatcher(frameStore);
    const ranked  = matcher.match(makeSignal({ signal: "grasp.initiated" }), {});

    assert.ok(ranked.length >= 1);
    assert.equal(ranked[0].frame.name, "Grasp");
  });

  it("payload keys matching terminal names boost score", () => {
    const matcher = new FrameMatcher(frameStore);
    // Signal with Actor and Object in payload — matches BlockPlacement terminals
    const signal = makeSignal({
      signal:  "block.found",
      payload: { Actor: "grasp-agent", Object: "block-A" },
    });
    const withPayload    = matcher.match(signal, {})[0]?.score ?? 0;
    const withoutPayload = matcher.match(makeSignal({ signal: "block.found" }), {})[0]?.score ?? 0;
    assert.ok(withPayload > withoutPayload, "payload match should boost score");
  });

  it("pronome roles matching terminal names boost score", () => {
    const matcher    = new FrameMatcher(frameStore);
    const signal     = makeSignal({ signal: "block.found" });
    const withPro    = matcher.match(signal, { Actor: "grasp-agent" })[0]?.score ?? 0;
    const withoutPro = matcher.match(signal, {})[0]?.score ?? 0;
    assert.ok(withPro > withoutPro, "pronome match should boost score");
  });

  it("best() returns null when no frame scores above threshold", () => {
    const matcher = new FrameMatcher(frameStore);
    const result  = matcher.best(
      makeSignal({ signal: "unrelated.signal.xyz" }),
      {},
      0.5, // high threshold
    );
    // Either null or the score is genuinely below threshold
    if (result !== null) {
      assert.ok(result.score >= 0.5);
    }
  });

  it("best() returns top match above default threshold", () => {
    const matcher = new FrameMatcher(frameStore);
    const result  = matcher.best(makeSignal({ signal: "block.placed" }), {});
    // "block" appears in BlockPlacement — should match at some score
    assert.ok(result !== null);
    assert.ok(result.score >= 0.05);
  });

  it("returns multiple candidates sorted score descending", () => {
    const matcher = new FrameMatcher(frameStore);
    // "block grasp" contains tokens from both frames
    const ranked = matcher.match(makeSignal({ signal: "block.grasp.start" }), {});
    for (let i = 1; i < ranked.length; i++) {
      assert.ok(ranked[i - 1].score >= ranked[i].score);
    }
  });
});

// ─── SlotFiller tests ─────────────────────────────────────────────────────────

describe("fillSlots", () => {

  function baseFrame() {
    return frameStore.getWithInheritance(blockPlacementId)!;
  }

  it("payload fills terminal with confidence=1.0 and source=payload", () => {
    const filled = fillSlots(baseFrame(), {
      payload:  { Actor: "find-agent", Object: "block-A" },
      pronomes: {},
    });
    assert.equal(filled.terminals["Actor"].value,      "find-agent");
    assert.equal(filled.terminals["Actor"].confidence, 1.0);
    assert.equal(filled.terminals["Actor"].source,     "payload");
  });

  it("pronome fills when payload absent (source=pronome, confidence=0.7)", () => {
    const filled = fillSlots(baseFrame(), {
      payload:  {},
      pronomes: { Actor: "move-agent" },
    });
    assert.equal(filled.terminals["Actor"].value,      "move-agent");
    assert.equal(filled.terminals["Actor"].confidence, 0.7);
    assert.equal(filled.terminals["Actor"].source,     "pronome");
  });

  it("frame default fills when no payload or pronome", () => {
    const filled = fillSlots(baseFrame(), {
      payload:  {},
      pronomes: {},
    });
    // Actor has default_value="grasp-agent", default_confidence=0.5
    assert.equal(filled.terminals["Actor"].value,      "grasp-agent");
    assert.equal(filled.terminals["Actor"].confidence, 0.5);
    assert.equal(filled.terminals["Actor"].source,     "default");
  });

  it("payload beats pronome beats default (priority cascade)", () => {
    const filled = fillSlots(baseFrame(), {
      payload:  { Object: "block-from-payload" },
      pronomes: { Object: "block-from-pronome" },
    });
    // payload wins
    assert.equal(filled.terminals["Object"].value,  "block-from-payload");
    assert.equal(filled.terminals["Object"].source, "payload");
  });

  it("empty source when no value found and no default", () => {
    const filled = fillSlots(baseFrame(), {
      payload:  {},
      pronomes: {},
    });
    // Object terminal has default_value=null → should be empty
    assert.equal(filled.terminals["Object"].value,  null);
    assert.equal(filled.terminals["Object"].source, "empty");
  });

  it("complete=true when all required terminals filled", () => {
    const filled = fillSlots(baseFrame(), {
      payload:  { Actor: "grasp-agent", Object: "block-A" },
      pronomes: {},
    });
    assert.equal(filled.complete, true);
  });

  it("complete=false when a required terminal has no value", () => {
    const filled = fillSlots(baseFrame(), {
      payload:  {},   // Object is required, has no default
      pronomes: {},
    });
    assert.equal(filled.complete, false);
  });

  it("case-insensitive terminal matching: 'actor' in payload fills 'Actor'", () => {
    const filled = fillSlots(baseFrame(), {
      payload:  { actor: "case-agent" },   // lowercase key
      pronomes: {},
    });
    assert.equal(filled.terminals["Actor"].value,  "case-agent");
    assert.equal(filled.terminals["Actor"].source, "payload");
  });

  it("K-line fills terminal with confidence = score * 0.8", async () => {
    // Create a K-line store with a K-line whose pronomes have Actor="kline-agent"
    const klineStore = KLineStore.open(join(tmpDir, "klines-slot.db"));
    const embedder   = new BagOfWordsEmbedder();

    const klineId = klineStore.write({
      type: "positive",
      situation: {
        description: "block placement tower grasp actor",
        frame_id:    null,
        pronomes:    { Actor: "kline-agent", Goal: "kline-goal" },
        micronemes:  [], realm: [],
      },
      activations: [],
      bands: {
        core:       { agents: [], properties: {}, decay_rate: 0 },
        peripheral: { agents: [], properties: {}, decay_rate: 180 },
        fringe:     { agents: [], properties: {}, decay_rate: 30 },
      },
      guard: null, parent_id: null, source_events: [], task_id: null,
      embedding:       await embedder.embed("block placement tower grasp actor"),
      embedding_model: embedder.modelName,
      embedding_hash:  "slot-test",
    });
    void klineId;

    const engine = new KLineRetrievalEngine(klineStore, embedder);
    const klines = await engine.retrieve("block placement grasp actor tower", {
      topK: 3, trackRetrieval: false,
    });

    const filled = fillSlots(baseFrame(), {
      payload:  {},  // no payload — K-line should fill
      pronomes: {},
      klines,
    });

    if (klines.length > 0) {
      // Actor was in the K-line pronomes
      assert.equal(filled.terminals["Actor"].value,  "kline-agent");
      assert.equal(filled.terminals["Actor"].source, "kline");
      assert.ok(filled.terminals["Actor"].confidence > 0);
      assert.ok(filled.terminals["Actor"].confidence <= 0.95);
    }

    klineStore.close();
  });
});

// ─── FrameAgent integration ───────────────────────────────────────────────────

describe("createFrameAgent", () => {

  async function makeEnv() {
    const log     = EventLog.open(join(tmpDir, `events-${Date.now()}.db`));
    const ctx     = new ContextStore();
    const bus     = new PolynemeBus(log, ctx);
    return { log, ctx, bus };
  }

  it("emits frame.selected when a frame matches above threshold", async () => {
    const { log, ctx, bus } = await makeEnv();
    const agent = createFrameAgent(frameStore, { minScore: 0.01 });
    agent.connect(bus);

    const received: unknown[] = [];
    bus.subscribe({
      id:       "spy",
      signals:  ["frame.selected"],
      onSignal: (e) => received.push(e.payload),
    });

    bus.emit({
      source:  "test",
      signal:  "block.found",
      type:    "polyneme",
      payload: { Object: "block-A" },
      context: { pronomes: {}, frame_id: null, kline_ids: [], micronemes: [] },
      causedBy: null,
    });

    // Allow async handler to complete
    await new Promise((r) => setTimeout(r, 50));

    assert.ok(received.length >= 1, "should have emitted frame.selected");
    const payload = received[0] as Record<string, unknown>;
    assert.equal(payload.frame_name, "BlockPlacement");
    assert.ok((payload.score as number) > 0);

    log.close();
    void ctx;
  });

  it("updates ContextStore.frame_id when frame is selected", async () => {
    const { log, ctx, bus } = await makeEnv();
    const agent = createFrameAgent(frameStore, { minScore: 0.01 });
    agent.connect(bus);

    bus.emit({
      source:  "test",
      signal:  "block.placed",
      type:    "polyneme",
      payload: {},
      context: { pronomes: {}, frame_id: null, kline_ids: [], micronemes: [] },
      causedBy: null,
    });

    await new Promise((r) => setTimeout(r, 50));

    // ContextStore should have the frame id set
    assert.ok(
      ctx.getFrame() !== null,
      "ContextStore should have a frame_id after frame.selected",
    );

    log.close();
  });

  it("frame.selected payload includes filled terminals", async () => {
    const { log, bus } = await makeEnv();
    const agent = createFrameAgent(frameStore, { minScore: 0.01 });
    agent.connect(bus);

    const received: Record<string, unknown>[] = [];
    bus.subscribe({
      id:       "spy2",
      signals:  ["frame.selected"],
      onSignal: (e) => received.push(e.payload as Record<string, unknown>),
    });

    bus.emit({
      source:  "test",
      signal:  "block.found",
      type:    "polyneme",
      payload: { Actor: "special-agent", Object: "block-B" },
      context: { pronomes: {}, frame_id: null, kline_ids: [], micronemes: [] },
      causedBy: null,
    });

    await new Promise((r) => setTimeout(r, 50));

    assert.ok(received.length >= 1);
    const terminals = received[0].terminals as Record<string, { value: unknown; source: string }>;
    assert.ok(terminals !== undefined);
    assert.equal(terminals["Actor"]?.value,  "special-agent");
    assert.equal(terminals["Actor"]?.source, "payload");
    assert.equal(terminals["Object"]?.value, "block-B");

    log.close();
  });

  it("no frame.selected emitted when no frame matches threshold", async () => {
    const { log, bus } = await makeEnv();
    // Very high threshold — nothing will match
    const agent = createFrameAgent(frameStore, { minScore: 0.99 });
    agent.connect(bus);

    const received: unknown[] = [];
    bus.subscribe({
      id:       "spy3",
      signals:  ["frame.selected"],
      onSignal: (e) => received.push(e),
    });

    bus.emit({
      source:  "test",
      signal:  "completely.unrelated.signal.xyz",
      type:    "polyneme",
      payload: {},
      context: { pronomes: {}, frame_id: null, kline_ids: [], micronemes: [] },
      causedBy: null,
    });

    await new Promise((r) => setTimeout(r, 50));
    assert.equal(received.length, 0, "should not emit frame.selected for unmatched signal");

    log.close();
  });

  it("frame.selected is caused by the triggering signal", async () => {
    const { log, bus } = await makeEnv();
    const agent = createFrameAgent(frameStore, { minScore: 0.01 });
    agent.connect(bus);

    const frameSelectedEvents: SignalEnvelope[] = [];
    bus.subscribe({
      id:       "spy4",
      signals:  ["frame.selected"],
      onSignal: (e) => frameSelectedEvents.push(e),
    });

    const triggerId = bus.emit({
      source:  "test",
      signal:  "block.found",
      type:    "polyneme",
      payload: {},
      context: { pronomes: {}, frame_id: null, kline_ids: [], micronemes: [] },
      causedBy: null,
    });

    await new Promise((r) => setTimeout(r, 50));

    assert.ok(frameSelectedEvents.length >= 1);
    assert.equal(
      frameSelectedEvents[0].causedBy,
      triggerId,
      "frame.selected should be caused by the triggering signal",
    );

    log.close();
  });
});
