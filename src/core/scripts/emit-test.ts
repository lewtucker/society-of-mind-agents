/**
 * Manual test script — emits a sequence of block-stacking signals to the
 * event log and prints each id. Use this to verify the log is working and
 * to generate events that the introspection app will eventually display.
 *
 * Usage:  npm run emit-test
 *
 * The DB is written to ~/.som/events.db (created if it doesn't exist).
 */
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { EventLog } from "../event-log/index.ts";

const DB_DIR = join(homedir(), ".som");
const DB_PATH = join(DB_DIR, "events.db");

mkdirSync(DB_DIR, { recursive: true });

const log = EventLog.open(DB_PATH);
console.log(`Event log opened at ${DB_PATH}`);
console.log(`Current event count: ${log.count()}\n`);

// Emit a mini block-stacking scenario
const events: Array<Parameters<typeof log.emit>[0]> = [
  { source: "goal-manager",   signal: "goal.set",       type: "activation", payload: { goal: "build_tower", height: 3 }, context: { pronomes: {}, frame_id: null, kline_ids: [], micronemes: [] }, causedBy: null },
  { source: "frame-selector", signal: "frame.selected", type: "activation", payload: { frame: "Builder", confidence: 0.94 }, context: { pronomes: { Goal: "goal-manager" }, frame_id: "frame-builder-001", kline_ids: [], micronemes: [] }, causedBy: null },
  { source: "builder",        signal: "builder.step",   type: "activation", payload: { step: 1, of: 3 }, context: { pronomes: { Actor: "builder" }, frame_id: "frame-builder-001", kline_ids: [], micronemes: [] }, causedBy: null },
  { source: "builder",        signal: "block.search",   type: "polyneme",   payload: {}, context: { pronomes: { Actor: "builder" }, frame_id: "frame-builder-001", kline_ids: [], micronemes: [] }, causedBy: null },
];

// Emit the first signal and use its id as causedBy for subsequent ones
let lastId: string | null = null;
for (const e of events) {
  if (lastId) e.causedBy = lastId;
  lastId = log.emit(e);
  console.log(`  ${lastId}  ${e.source.padEnd(16)} → ${e.signal}`);
}

// Emit concurrent Find + See (same causedBy — both caused by block.search)
const searchId = lastId!;
const findId = log.emit({ source: "find", signal: "activation", type: "activation", payload: { status: "searching" }, context: { pronomes: {}, frame_id: "frame-builder-001", kline_ids: [], micronemes: [] }, causedBy: searchId });
const seeId  = log.emit({ source: "see",  signal: "activation", type: "activation", payload: { status: "scanning" },  context: { pronomes: {}, frame_id: "frame-builder-001", kline_ids: [], micronemes: [] }, causedBy: searchId });
console.log(`  ${findId}  find             → activation  (caused by block.search)`);
console.log(`  ${seeId}   see              → activation  (caused by block.search — concurrent)`);

const foundId = log.emit({ source: "find", signal: "block.found", type: "polyneme", payload: { blockId: "A", position: [2, 0] }, context: { pronomes: { Object: "block-A" }, frame_id: "frame-builder-001", kline_ids: [], micronemes: [] }, causedBy: findId });
console.log(`  ${foundId}  find             → block.found`);

console.log(`\nTotal events now: ${log.count()}`);
log.close();
