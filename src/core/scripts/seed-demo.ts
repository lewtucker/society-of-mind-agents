/**
 * Seed script for the introspection app demo.
 *
 * Runs a real 3-block tower-build using the full agent society and writes
 * both events and K-lines to ~/.som/ so the introspection app shows real data:
 *
 *   ~/.som/events.db  — event log (switches app from simulation to live mode)
 *   ~/.som/klines.db  — K-line store (Memory Feedback Graph + query panel)
 *
 * Usage:  npm run seed-demo
 */
import { mkdirSync } from "node:fs";
import { homedir }   from "node:os";
import { join }      from "node:path";

import { EventLog }              from "../event-log/EventLog.ts";
import { PolynemeBus }           from "../polyneme-bus/PolynemeBus.ts";
import { ContextStore }          from "../context/ContextStore.ts";
import { Agency }                from "../agency/Agency.ts";
import { KLineStore }            from "../kline/KLineStore.ts";
import { BagOfWordsEmbedder }    from "../kline/embedding.ts";
import { createMemoryCaptureAgent } from "../kline/capture.ts";
import { createCensorCaptureAgent } from "../kline/censor.ts";
import {
  createFindAgent,
  createSeeAgent,
  createGraspAgent,
  createMoveAgent,
  createPutAgent,
} from "../demo/agents.ts";

// ─── Paths ────────────────────────────────────────────────────────────────────

const SOM_DIR    = join(homedir(), ".som");
const EVENTS_DB  = join(SOM_DIR, "events.db");
const KLINES_DB  = join(SOM_DIR, "klines.db");

mkdirSync(SOM_DIR, { recursive: true });

// ─── Open stores ──────────────────────────────────────────────────────────────

const log        = EventLog.open(EVENTS_DB);
const klineStore = KLineStore.open(KLINES_DB);
const embedder   = new BagOfWordsEmbedder();

console.log(`Event log  → ${EVENTS_DB}  (${log.count()} existing events)`);
console.log(`K-line store → ${KLINES_DB}`);
console.log();

// ─── Pre-seed a censor K-line ─────────────────────────────────────────────────

const censorDesc = "block tower grasp already placed reuse collision failure";
klineStore.write({
  type: "censor",
  situation: {
    description: censorDesc,
    frame_id:    null,
    pronomes:    { Object: "block-A" },
    micronemes:  [],
    realm:       [],
  },
  activations: [],
  bands: {
    core:       { agents: ["grasp-agent"], properties: {}, decay_rate: 0 },
    peripheral: { agents: [],             properties: {}, decay_rate: 180 },
    fringe:     { agents: [],             properties: {}, decay_rate: 30 },
  },
  guard: {
    precursor_pattern:   "Grasping a block already placed in the tower",
    blocked_action:      "grasp_block",
    outcome_description: "Tower collapsed when already-placed block was disturbed",
  },
  parent_id:       null,
  source_events:   [],
  task_id:         null,
  embedding:       await embedder.embed(censorDesc),
  embedding_model: embedder.modelName,
  embedding_hash:  "seed-censor-1",
});
console.log("✓ Censor K-line seeded (grasp_block / tower collapse)");

// ─── Wire the society ─────────────────────────────────────────────────────────

const bus = new PolynemeBus(log, new ContextStore());

const agency = new Agency({
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
agency.connect(bus);

// Memory capture agent — writes positive K-line on task.succeeded
createMemoryCaptureAgent(log, klineStore, embedder).connect(bus);

// Censor capture agent — writes censor K-line on task.failed / bad_outcome
createCensorCaptureAgent(log, klineStore, embedder).connect(bus);

// ─── Run the task ─────────────────────────────────────────────────────────────

const succeeded: string[] = [];
bus.subscribe({
  id:       "seed-spy",
  signals:  ["task.succeeded", "kline.captured"],
  onSignal: (e) => {
    if (e.signal === "task.succeeded") succeeded.push(e.id);
    if (e.signal === "kline.captured") {
      const p = e.payload as Record<string, unknown>;
      console.log(`  ✓ K-line captured: ${p.kline_id}`);
    }
  },
});

console.log("\nRunning 3-block tower build…");
bus.emit({
  source:   "seed-script",
  signal:   "task.start",
  type:     "polyneme",
  payload:  { task_id: "demo-seed-1", blocks: ["block-A", "block-B", "block-C"] },
  context:  { pronomes: {}, frame_id: null, kline_ids: [], micronemes: [] },
  causedBy: null,
});

// Wait for async K-line capture to complete
await new Promise((r) => setTimeout(r, 500));

console.log(`\n✓ task.succeeded fired: ${succeeded.length > 0}`);
console.log(`✓ Events in log: ${log.count()}`);

const klineCount = klineStore.list().length;
console.log(`✓ K-lines in store: ${klineCount}`);
console.log("\nDone. Reload http://localhost:3000 to see real data.");

log.close();
klineStore.close();
