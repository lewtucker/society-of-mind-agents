/**
 * Learning Curve Demo
 *
 * Runs 5 block-builder tasks in sequence. After each run, queries the K-line
 * store to show how retrieval scores improve as memory accumulates.
 *
 * Usage: npm run demo:learning-curve
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

const SOM_DIR = join(homedir(), ".som");
mkdirSync(SOM_DIR, { recursive: true });

const log        = EventLog.open(join(SOM_DIR, "events.db"));
const klineStore = KLineStore.open(join(SOM_DIR, "klines.db"));
const embedder   = new BagOfWordsEmbedder();
const retrieval  = new KLineRetrievalEngine(klineStore, embedder);

const RUNS = 5;
const QUERY = "block tower build grasp place stack";

console.log(`━━━ Learning Curve Demo (${RUNS} builds) ━━━\n`);

for (let i = 1; i <= RUNS; i++) {
  // Fresh bus per run (simulates separate sessions)
  const bus = new PolynemeBus(log, new ContextStore());
  new Agency({ id: "builder-agency", name: "Builder Agency", members: [
    createFindAgent(), createSeeAgent(), createGraspAgent(), createMoveAgent(), createPutAgent(),
  ]}).connect(bus);
  createMemoryCaptureAgent(log, klineStore, embedder).connect(bus);

  await new Promise<void>((resolve) => {
    bus.subscribe({ id: `spy-${i}`, signals: ["task.succeeded"], onSignal: () => resolve() });
    bus.emit({
      source: "demo", signal: "task.start", type: "polyneme",
      payload: { task_id: `curve-run-${i}`, blocks: ["block-A", "block-B", "block-C"] },
      context: { pronomes: {}, frame_id: null, kline_ids: [], micronemes: [] },
      causedBy: null,
    });
  });

  await new Promise((r) => setTimeout(r, 400));

  // Query after this run
  const results = await retrieval.retrieve(QUERY, { topK: 3, typeFilter: "positive" });
  const topScore = results[0]?.score ?? 0;
  const bar = "█".repeat(Math.round(topScore * 20)).padEnd(20, "░");

  console.log(`Run ${i}  K-lines: ${klineStore.list().length.toString().padStart(2)}  top score: [${bar}] ${(topScore * 100).toFixed(0)}%`);
}

console.log("\nDone. The Memory Feedback Graph now shows all accumulated K-lines.");
console.log("Run MEMORY_PROBE in the query panel with: \"block tower build\"");
log.close();
klineStore.close();
