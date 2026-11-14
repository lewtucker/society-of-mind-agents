/**
 * Cross-Society Retrieval Demo
 *
 * Runs a block-builder task, then runs three conversation turns asking about
 * "block stacking" and "tower building". The conversation RetrievalAgent finds
 * K-lines captured by the block-builder — demonstrating cross-society memory.
 *
 * Usage: npm run demo:cross-society
 */
import { mkdirSync }                from "node:fs";
import { homedir }                  from "node:os";
import { join }                     from "node:path";

import { EventLog }                 from "../event-log/EventLog.ts";
import { PolynemeBus }              from "../polyneme-bus/PolynemeBus.ts";
import { ContextStore }             from "../context/ContextStore.ts";
import { Agency }                   from "../agency/Agency.ts";
import { KLineStore }               from "../kline/KLineStore.ts";
import { BagOfWordsEmbedder }       from "../kline/embedding.ts";
import { KLineRetrievalEngine }     from "../kline/retrieval.ts";
import { createMemoryCaptureAgent } from "../kline/capture.ts";
import { createFindAgent, createSeeAgent, createGraspAgent, createMoveAgent, createPutAgent } from "../demo/agents.ts";
import { createTopicAgent, createRetrievalAgent, createResponseAgent, createConversationMemoryAgent } from "../conversation/agents.ts";
import type { ConversationResponsePayload } from "../conversation/types.ts";
import type { SignalEnvelope }              from "../event-log/types.ts";

const SOM_DIR   = join(homedir(), ".som");
mkdirSync(SOM_DIR, { recursive: true });

const log        = EventLog.open(join(SOM_DIR, "events.db"));
const klineStore = KLineStore.open(join(SOM_DIR, "klines.db"));
const embedder   = new BagOfWordsEmbedder();
const retrieval  = new KLineRetrievalEngine(klineStore, embedder);

const bus = new PolynemeBus(log, new ContextStore());

new Agency({ id: "builder-agency", name: "Builder Agency", members: [
  createFindAgent(), createSeeAgent(), createGraspAgent(), createMoveAgent(), createPutAgent(),
]}).connect(bus);
createMemoryCaptureAgent(log, klineStore, embedder).connect(bus);

new Agency({ id: "conversation-agency", name: "Conversation Agency", members: [
  createTopicAgent(), createRetrievalAgent(retrieval), createResponseAgent(),
]}).connect(bus);
createConversationMemoryAgent(log, klineStore, embedder).connect(bus);

// ─── Step 1: Block build ──────────────────────────────────────────────────────

console.log("━━━ Step 1: Block Builder Society ━━━");
console.log("Running 3-block tower build…");

await new Promise<void>((resolve) => {
  bus.subscribe({
    id: "build-spy", signals: ["task.succeeded"],
    onSignal: () => resolve(),
  });
  bus.emit({
    source: "demo", signal: "task.start", type: "polyneme",
    payload: { task_id: "cross-demo-build", blocks: ["block-A", "block-B", "block-C"] },
    context: { pronomes: {}, frame_id: null, kline_ids: [], micronemes: [] },
    causedBy: null,
  });
});

await new Promise((r) => setTimeout(r, 400));
console.log(`✓ Build complete. K-lines: ${klineStore.list().length}\n`);

// ─── Step 2: Conversation turns ───────────────────────────────────────────────

console.log("━━━ Step 2: Conversational Society ━━━");
console.log("(Asking about block stacking — will these find the builder's K-lines?)\n");

const queries = [
  "tell me about block stacking",
  "how does tower building work",
  "explain the block placement process",
];

for (const query of queries) {
  const turnId = `cross-turn-${Date.now()}`;
  const result = await new Promise<{ response: string; memories: number }>((resolve) => {
    bus.subscribe({
      id: `spy-${turnId}`, signals: ["conversation.response"],
      onSignal: (e: SignalEnvelope) => {
        const p = e.payload as ConversationResponsePayload;
        if (p.turn_id === turnId) resolve({ response: p.response, memories: p.retrieved_kline_ids.length });
      },
    });
    bus.emit({
      source: "demo", signal: "conversation.input", type: "polyneme",
      payload: { turn_id: turnId, query },
      context: { pronomes: {}, frame_id: null, kline_ids: [], micronemes: [] },
      causedBy: null,
    });
  });

  await new Promise((r) => setTimeout(r, 400));
  console.log(`Q: ${query}`);
  console.log(`A: ${result.response}`);
  console.log(`   Memories retrieved: ${result.memories} (${result.memories > 0 ? "✓ found builder K-lines" : "none yet"})`);
  console.log(`   K-lines in store: ${klineStore.list().length}\n`);
}

console.log("Done. Reload http://localhost:3000 to see the cross-society graph.");
log.close();
klineStore.close();
