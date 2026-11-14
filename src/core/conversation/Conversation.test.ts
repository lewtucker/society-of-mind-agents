/**
 * Conversational Agent Society — Phase 5.2 integration test
 *
 * Validates the conversation memory pipeline:
 *   Turn 1: conversation.input flows through the full signal chain to kline.captured
 *   Turn 2: second turn on the same topic retrieves Turn 1's K-line from memory
 *   Unrelated topic: no cross-retrieval (retrieved klines is empty)
 *   CausedBy: full chain links conversation.response back to conversation.input
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventLog } from "../event-log/EventLog.ts";
import { PolynemeBus } from "../polyneme-bus/PolynemeBus.ts";
import { ContextStore } from "../context/ContextStore.ts";
import { Agency } from "../agency/Agency.ts";
import { KLineStore } from "../kline/KLineStore.ts";
import { BagOfWordsEmbedder } from "../kline/embedding.ts";
import { KLineRetrievalEngine } from "../kline/retrieval.ts";
import type { SignalEnvelope } from "../event-log/types.ts";
import {
  createTopicAgent,
  createRetrievalAgent,
  createResponseAgent,
  createConversationMemoryAgent,
} from "./agents.ts";
import type { ContextRetrievedPayload, ConversationResponsePayload } from "./types.ts";

// ─── Shared infrastructure ────────────────────────────────────────────────────

let tmpDir:    string;
let log:       EventLog;
let klineStore: KLineStore;
let retrieval:  KLineRetrievalEngine;

const embedder = new BagOfWordsEmbedder();

before(async () => {
  tmpDir     = await mkdtemp(join(tmpdir(), "som-conv-test-"));
  log        = EventLog.open(join(tmpDir, "events.db"));
  klineStore = KLineStore.open(join(tmpDir, "klines.db"));
  retrieval  = new KLineRetrievalEngine(klineStore, embedder);
});

after(async () => {
  log.close();
  klineStore.close();
  await rm(tmpDir, { recursive: true });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeBus(): PolynemeBus {
  return new PolynemeBus(log, new ContextStore());
}

function collect(bus: PolynemeBus, signal: string): SignalEnvelope[] {
  const received: SignalEnvelope[] = [];
  bus.subscribe({
    id:       `spy-${signal}-${Date.now()}-${Math.random()}`,
    signals:  [signal],
    onSignal: (e) => received.push(e),
  });
  return received;
}

function connectSociety(bus: PolynemeBus) {
  const agency = new Agency({
    id:   "conversation-agency",
    name: "Conversation Agency",
    members: [
      createTopicAgent(),
      createRetrievalAgent(retrieval),
      createResponseAgent(),
      createConversationMemoryAgent(log, klineStore, embedder),
    ],
  });
  agency.connect(bus);
  return agency;
}

function startTurn(bus: PolynemeBus, turnId: string, query: string): string {
  return bus.emit({
    source:   "test",
    signal:   "conversation.input",
    type:     "polyneme",
    payload:  { turn_id: turnId, query },
    context:  { pronomes: {}, frame_id: null, kline_ids: [], micronemes: [] },
    causedBy: null,
  });
}

// ─── Signal chain ─────────────────────────────────────────────────────────────

describe("Signal chain", () => {

  it("conversation.input fires topic.identified", async () => {
    const bus = makeBus();
    connectSociety(bus);
    const topics = collect(bus, "topic.identified");

    startTurn(bus, "turn-chain-1", "tell me about block stacking");
    await new Promise((r) => setTimeout(r, 200));

    assert.ok(topics.length >= 1, "topic.identified should fire");
    const p = topics[0].payload as Record<string, unknown>;
    assert.equal(typeof p.topic, "string");
    assert.ok(Array.isArray(p.keywords));
  });

  it("topic.identified fires context.retrieved", async () => {
    const bus = makeBus();
    connectSociety(bus);
    const retrieved = collect(bus, "context.retrieved");

    startTurn(bus, "turn-chain-2", "tell me about block stacking");
    await new Promise((r) => setTimeout(r, 200));

    assert.ok(retrieved.length >= 1, "context.retrieved should fire");
    const p = retrieved[0].payload as ContextRetrievedPayload;
    assert.equal(typeof p.topic, "string");
    assert.ok(Array.isArray(p.klines));
  });

  it("context.retrieved fires conversation.response", async () => {
    const bus = makeBus();
    connectSociety(bus);
    const responses = collect(bus, "conversation.response");

    startTurn(bus, "turn-chain-3", "tell me about block stacking");
    await new Promise((r) => setTimeout(r, 200));

    assert.ok(responses.length >= 1, "conversation.response should fire");
    const p = responses[0].payload as ConversationResponsePayload;
    assert.equal(typeof p.response, "string");
    assert.ok(p.response.length > 0);
  });

  it("conversation.response fires kline.captured", async () => {
    const bus = makeBus();
    connectSociety(bus);
    const captured = collect(bus, "kline.captured");

    startTurn(bus, "turn-chain-4", "tell me about block stacking");
    await new Promise((r) => setTimeout(r, 500));

    assert.ok(captured.length >= 1, "kline.captured should fire");
  });

});

// ─── CausedBy chain ───────────────────────────────────────────────────────────

describe("CausedBy chain", () => {

  it("conversation.response causedBy chain reaches back to conversation.input", async () => {
    const bus = makeBus();
    connectSociety(bus);
    const responses = collect(bus, "conversation.response");

    startTurn(bus, "turn-causal-1", "block stacking tutorial");
    await new Promise((r) => setTimeout(r, 300));

    assert.ok(responses.length >= 1);
    assert.ok(responses[0].causedBy !== null, "conversation.response should have causedBy");

    // Walk chain — should reach conversation.input
    let current: SignalEnvelope | null = responses[0];
    const signals: string[] = [];
    let depth = 0;
    while (current !== null && depth < 10) {
      signals.push(current.signal);
      const parentId = current.causedBy;
      if (!parentId) break;
      current = log.getById(parentId) ?? null;
      depth++;
    }
    assert.ok(signals.includes("conversation.input"), `chain should reach conversation.input; got: ${signals.join(" → ")}`);
  });

});

// ─── K-line capture ───────────────────────────────────────────────────────────

describe("K-line capture", () => {

  it("K-line description contains conversation topic vocabulary", async () => {
    const bus = makeBus();
    connectSociety(bus);
    const captured = collect(bus, "kline.captured");

    startTurn(bus, "turn-kline-1", "block stacking tutorial");
    await new Promise((r) => setTimeout(r, 500));

    assert.ok(captured.length >= 1);
    const desc = (captured[0].payload as Record<string, unknown>).situationDescription as string;
    assert.ok(typeof desc === "string" && desc.length > 0, "K-line should have a description");
    // Description should include topic vocabulary for future retrieval
    assert.ok(
      desc.toLowerCase().includes("block") || desc.toLowerCase().includes("conversation"),
      `description should contain topic vocabulary; got: "${desc}"`,
    );
  });

  it("captured K-line is retrievable by topic query", async () => {
    const bus = makeBus();
    connectSociety(bus);
    const captured = collect(bus, "kline.captured");

    startTurn(bus, "turn-kline-2", "block stacking methods");
    await new Promise((r) => setTimeout(r, 500));

    assert.ok(captured.length >= 1);
    const klineId = (captured[0].payload as Record<string, unknown>).klineId as string;

    // Retrieve from store — should find it by topic
    const results = await retrieval.retrieve("block stacking", { topK: 5, trackRetrieval: false });
    const ids = results.map((r) => r.kline.id);
    assert.ok(ids.includes(klineId), "captured K-line should be retrievable by topic query");
  });

});

// ─── Cross-session retrieval ──────────────────────────────────────────────────

describe("Cross-session retrieval", () => {

  it("second turn on the same topic finds the first turn's K-line", async () => {
    // Turn A — seeds a K-line about "block stacking"
    const busA = makeBus();
    connectSociety(busA);
    const capturedA = collect(busA, "kline.captured");

    startTurn(busA, "turn-xsession-A", "block stacking demonstration");
    await new Promise((r) => setTimeout(r, 500));
    assert.ok(capturedA.length >= 1, "Turn A should capture a K-line");

    // Turn B — same topic, fresh bus; retrieval should find Turn A's K-line
    const busB = makeBus();
    connectSociety(busB);
    const retrievedB = collect(busB, "context.retrieved");

    startTurn(busB, "turn-xsession-B", "explain block stacking");
    await new Promise((r) => setTimeout(r, 500));

    assert.ok(retrievedB.length >= 1, "Turn B should receive context.retrieved");
    const p = retrievedB[0].payload as ContextRetrievedPayload;
    assert.ok(p.klines.length > 0, "Turn B should retrieve at least one K-line from Turn A");
  });

  it("response on second turn includes retrieved_kline_ids", async () => {
    // At this point the store already has K-lines from prior tests
    const bus = makeBus();
    connectSociety(bus);
    const responses = collect(bus, "conversation.response");

    startTurn(bus, "turn-xsession-C", "block stacking how-to");
    await new Promise((r) => setTimeout(r, 500));

    assert.ok(responses.length >= 1);
    const p = responses[0].payload as ConversationResponsePayload;
    assert.ok(p.retrieved_kline_ids.length > 0, "second turn response should list retrieved K-line IDs");
    assert.ok(
      p.response.includes("drawing on"),
      `response should mention retrieved memories; got: "${p.response}"`,
    );
  });

  it("unrelated topic retrieves no block-stacking K-lines", async () => {
    const bus = makeBus();
    connectSociety(bus);
    const retrieved = collect(bus, "context.retrieved");

    startTurn(bus, "turn-unrelated-1", "quantum physics entanglement");
    await new Promise((r) => setTimeout(r, 300));

    assert.ok(retrieved.length >= 1);
    const p = retrieved[0].payload as ContextRetrievedPayload;
    // K-lines stored so far are all "block stacking" vocabulary; unrelated query should return none
    assert.equal(p.klines.length, 0, "unrelated topic should not retrieve block-stacking K-lines");
  });

});
