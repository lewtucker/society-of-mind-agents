/**
 * Unified Society REPL — block-builder + conversational agents on one bus.
 *
 * Both societies share ~/.som/events.db and ~/.som/klines.db, so:
 *   - Conversation agents can retrieve K-lines captured by the block-builder
 *   - Block-builder K-lines appear in the Memory Feedback Graph alongside
 *     conversation K-lines
 *
 * Commands:
 *   <any text>   — conversation turn (topic extraction → retrieval → response → capture)
 *   /build       — run a 3-block tower build (fires block-builder agents)
 *   /quit        — exit
 *
 * Usage:  npm run converse
 */
import { createInterface }          from "node:readline";
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

import {
  createFindAgent,
  createSeeAgent,
  createGraspAgent,
  createMoveAgent,
  createPutAgent,
} from "../demo/agents.ts";

import {
  createTopicAgent,
  createRetrievalAgent,
  createResponseAgent,
  createConversationMemoryAgent,
} from "../conversation/agents.ts";

import type { ConversationResponsePayload } from "../conversation/types.ts";
import type { SignalEnvelope }              from "../event-log/types.ts";

// ─── Paths ────────────────────────────────────────────────────────────────────

const SOM_DIR   = join(homedir(), ".som");
const EVENTS_DB = join(SOM_DIR, "events.db");
const KLINES_DB = join(SOM_DIR, "klines.db");

mkdirSync(SOM_DIR, { recursive: true });

// ─── Open stores ──────────────────────────────────────────────────────────────

const log        = EventLog.open(EVENTS_DB);
const klineStore = KLineStore.open(KLINES_DB);
const embedder   = new BagOfWordsEmbedder();
const retrieval  = new KLineRetrievalEngine(klineStore, embedder);

// ─── Wire unified society ─────────────────────────────────────────────────────

const bus = new PolynemeBus(log, new ContextStore());

// Block-builder agents
const builderAgency = new Agency({
  id:      "builder-agency",
  name:    "Builder Agency",
  members: [
    createFindAgent(),
    createSeeAgent(),
    createGraspAgent(),
    createMoveAgent(),
    createPutAgent(),
  ],
});
builderAgency.connect(bus);

// Memory capture for block-builder task.succeeded
createMemoryCaptureAgent(log, klineStore, embedder).connect(bus);

// Conversational agents
const conversationAgency = new Agency({
  id:      "conversation-agency",
  name:    "Conversation Agency",
  members: [
    createTopicAgent(),
    createRetrievalAgent(retrieval),
    createResponseAgent(),
  ],
});
conversationAgency.connect(bus);

// Conversation memory capture
createConversationMemoryAgent(log, klineStore, embedder).connect(bus);

// ─── Helpers ──────────────────────────────────────────────────────────────────

let buildCount = 0;

function runBuild(): Promise<string> {
  return new Promise((resolve) => {
    const taskId = `build-${++buildCount}`;
    const blocks = ["block-A", "block-B", "block-C"];

    const unsub = { id: `build-spy-${taskId}` };
    bus.subscribe({
      ...unsub,
      signals:  ["task.succeeded"],
      onSignal: (e: SignalEnvelope) => {
        const p = e.payload as Record<string, unknown>;
        if (p.task_id === taskId) resolve(`Tower built: ${(p.placed as string[]).join(", ")}`);
      },
    });

    bus.emit({
      source:   "repl",
      signal:   "task.start",
      type:     "polyneme",
      payload:  { task_id: taskId, blocks },
      context:  { pronomes: {}, frame_id: null, kline_ids: [], micronemes: [] },
      causedBy: null,
    });
  });
}

function converse(query: string): Promise<{ response: string; memories: number }> {
  return new Promise((resolve) => {
    const turnId = `turn-${Date.now()}`;

    bus.subscribe({
      id:       `converse-spy-${turnId}`,
      signals:  ["conversation.response"],
      onSignal: (e: SignalEnvelope) => {
        const p = e.payload as ConversationResponsePayload;
        if (p.turn_id === turnId) {
          resolve({
            response: p.response,
            memories: p.retrieved_kline_ids.length,
          });
        }
      },
    });

    bus.emit({
      source:   "repl",
      signal:   "conversation.input",
      type:     "polyneme",
      payload:  { turn_id: turnId, query },
      context:  { pronomes: {}, frame_id: null, kline_ids: [], micronemes: [] },
      causedBy: null,
    });
  });
}

// ─── REPL ─────────────────────────────────────────────────────────────────────

const rl = createInterface({ input: process.stdin, output: process.stdout });

console.log("╔══════════════════════════════════════════╗");
console.log("║  Society of Mind — Unified Society REPL  ║");
console.log("╠══════════════════════════════════════════╣");
console.log("║  <text>   conversation turn               ║");
console.log("║  /build   run a 3-block tower build       ║");
console.log("║  /quit    exit                            ║");
console.log("╚══════════════════════════════════════════╝");
console.log(`\nK-lines in store: ${klineStore.list().length}`);
console.log("Watching introspection app at http://localhost:3000\n");

function prompt() {
  rl.question("you> ", async (input) => {
    const line = input.trim();

    if (!line) { prompt(); return; }

    if (line === "/quit") {
      console.log("Closing…");
      log.close();
      klineStore.close();
      rl.close();
      return;
    }

    if (line === "/build") {
      process.stdout.write("building… ");
      try {
        const result = await Promise.race([
          runBuild(),
          new Promise<string>((_, reject) => setTimeout(() => reject(new Error("timeout")), 3000)),
        ]);
        console.log(result);
        // Wait for K-line capture
        await new Promise((r) => setTimeout(r, 400));
        console.log(`K-lines in store: ${klineStore.list().length}\n`);
      } catch {
        console.log("build timed out\n");
      }
      prompt();
      return;
    }

    // Conversation turn
    try {
      const result = await Promise.race([
        converse(line),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 3000)),
      ]);
      console.log(`\nsom> ${result.response}`);
      if (result.memories > 0) {
        console.log(`     (retrieved ${result.memories} K-line${result.memories > 1 ? "s" : ""} from memory)`);
      }
      // Wait for K-line capture
      await new Promise((r) => setTimeout(r, 400));
      console.log(`     K-lines in store: ${klineStore.list().length}\n`);
    } catch {
      console.log("som> (no response — timeout)\n");
    }

    prompt();
  });
}

prompt();
