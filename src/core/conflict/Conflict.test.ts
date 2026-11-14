import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventLog } from "../event-log/EventLog.ts";
import { PolynemeBus } from "../polyneme-bus/PolynemeBus.ts";
import { ContextStore } from "../context/ContextStore.ts";
import { createConflictResolver } from "./resolver.ts";
import type { SignalEnvelope } from "../event-log/types.ts";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

let tmpDir: string;

before(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "som-conflict-test-"));
});

after(async () => {
  await rm(tmpDir, { recursive: true });
});

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

function emitConflict(
  bus:                PolynemeBus,
  agent_id:           string,
  competing_agent_id: string,
  terminal:           string,
  priority:           number,
  competing_priority: number,
): string {
  return bus.emit({
    source:   "test",
    signal:   "agent.conflict",
    type:     "polyneme",
    payload:  { agent_id, competing_agent_id, terminal, priority, competing_priority },
    context:  { pronomes: {}, frame_id: null, kline_ids: [], micronemes: [] },
    causedBy: null,
  });
}

// ─── Cross-exclusion tests ─────────────────────────────────────────────────────

describe("ConflictResolver — cross-exclusion", () => {

  it("higher-priority agent wins: loser gets agent.suppressed", async () => {
    const { log, bus } = await makeEnv();
    createConflictResolver().connect(bus);

    const suppressed = collect(bus, "agent.suppressed");

    emitConflict(bus, "agent-A", "agent-B", "BlockX", 0.9, 0.5);

    await new Promise((r) => setTimeout(r, 50));

    assert.equal(suppressed.length, 1);
    const p = suppressed[0].payload as Record<string, unknown>;
    assert.equal(p.agent_id,  "agent-B");
    assert.equal(p.reason,    "cross-exclusion");
    assert.equal(p.terminal,  "BlockX");
    assert.equal(p.winner_id, "agent-A");

    log.close();
  });

  it("lower-priority agent wins when it is the competitor side", async () => {
    // Emit from the perspective of the lower-priority agent (competing side is higher)
    const { log, bus } = await makeEnv();
    createConflictResolver().connect(bus);

    const suppressed = collect(bus, "agent.suppressed");

    // agent-low (0.3) vs agent-high (0.8): agent-low should be suppressed
    emitConflict(bus, "agent-low", "agent-high", "BlockY", 0.3, 0.8);

    await new Promise((r) => setTimeout(r, 50));

    assert.equal(suppressed.length, 1);
    const p = suppressed[0].payload as Record<string, unknown>;
    assert.equal(p.agent_id,  "agent-low");
    assert.equal(p.winner_id, "agent-high");

    log.close();
  });

  it("tie in priority: alphabetically lower agent_id wins", async () => {
    const { log, bus } = await makeEnv();
    createConflictResolver().connect(bus);

    const suppressed = collect(bus, "agent.suppressed");

    // Equal priority — "agent-alpha" < "agent-zeta" alphabetically → alpha wins
    emitConflict(bus, "agent-zeta", "agent-alpha", "BlockZ", 0.5, 0.5);

    await new Promise((r) => setTimeout(r, 50));

    assert.equal(suppressed.length, 1);
    const p = suppressed[0].payload as Record<string, unknown>;
    assert.equal(p.agent_id,  "agent-zeta");
    assert.equal(p.winner_id, "agent-alpha");

    log.close();
  });

  it("tie outcome is consistent regardless of which side emits the conflict", async () => {
    const { log, bus } = await makeEnv();
    createConflictResolver().connect(bus);

    const suppressed = collect(bus, "agent.suppressed");

    // Same conflict, opposite perspective emission
    emitConflict(bus, "agent-alpha", "agent-zeta", "BlockW", 0.5, 0.5);

    await new Promise((r) => setTimeout(r, 50));

    // Same result: alpha wins, zeta suppressed
    const p = suppressed[0].payload as Record<string, unknown>;
    assert.equal(p.agent_id,  "agent-zeta");
    assert.equal(p.winner_id, "agent-alpha");

    log.close();
  });

  it("conflict on different terminals are tracked independently", async () => {
    const { log, bus } = await makeEnv();
    createConflictResolver({ noncompromiseThreshold: 5 }).connect(bus);

    const suppressed = collect(bus, "agent.suppressed");
    const noncomp    = collect(bus, "conflict.noncompromise");

    // Two different terminals — each conflict is counted separately
    emitConflict(bus, "agent-A", "agent-B", "TerminalP", 0.9, 0.5);
    emitConflict(bus, "agent-A", "agent-B", "TerminalQ", 0.9, 0.5);

    await new Promise((r) => setTimeout(r, 50));

    assert.equal(suppressed.length, 2);
    assert.equal(noncomp.length, 0, "should not trigger noncompromise — different terminals");

    log.close();
  });

  it("agent.suppressed is caused by the triggering agent.conflict signal", async () => {
    const { log, bus } = await makeEnv();
    createConflictResolver().connect(bus);

    const suppressed = collect(bus, "agent.suppressed");

    const triggerId = emitConflict(bus, "agent-A", "agent-B", "BlockV", 0.9, 0.1);

    await new Promise((r) => setTimeout(r, 50));

    assert.ok(suppressed.length >= 1);
    assert.equal(suppressed[0].causedBy, triggerId);

    log.close();
  });
});

// ─── Noncompromise tests ──────────────────────────────────────────────────────

describe("ConflictResolver — noncompromise", () => {

  it("after threshold rounds, both agents suppressed and conflict.noncompromise emitted", async () => {
    const { log, bus } = await makeEnv();
    createConflictResolver({ noncompromiseThreshold: 3 }).connect(bus);

    const suppressed = collect(bus, "agent.suppressed");
    const noncomp    = collect(bus, "conflict.noncompromise");

    // 3 rounds of conflict → noncompromise on round 3
    emitConflict(bus, "agent-A", "agent-B", "BlockNC", 0.9, 0.5);
    await new Promise((r) => setTimeout(r, 20));
    emitConflict(bus, "agent-A", "agent-B", "BlockNC", 0.9, 0.5);
    await new Promise((r) => setTimeout(r, 20));
    emitConflict(bus, "agent-A", "agent-B", "BlockNC", 0.9, 0.5);
    await new Promise((r) => setTimeout(r, 50));

    // First 2 rounds: 1 suppressed each = 2
    // Round 3 (noncompromise): 2 suppressed
    assert.ok(suppressed.length === 4, `expected 4 suppressed signals, got ${suppressed.length}`);
    assert.equal(noncomp.length, 1);

    const nc = noncomp[0].payload as Record<string, unknown>;
    assert.equal(nc.terminal, "BlockNC");
    assert.equal(nc.rounds, 3);
    assert.ok(Array.isArray(nc.agent_ids));
    assert.equal((nc.agent_ids as string[]).length, 2);

    log.close();
  });

  it("conflict.noncompromise suppresses both agents — no winner_id", async () => {
    const { log, bus } = await makeEnv();
    createConflictResolver({ noncompromiseThreshold: 2 }).connect(bus);

    const suppressed = collect(bus, "agent.suppressed");

    emitConflict(bus, "agent-X", "agent-Y", "Terminal1", 0.9, 0.5);
    await new Promise((r) => setTimeout(r, 20));
    emitConflict(bus, "agent-X", "agent-Y", "Terminal1", 0.9, 0.5);
    await new Promise((r) => setTimeout(r, 50));

    // Round 2 = noncompromise: both suppressed
    const noncompSuppressed = suppressed.filter(
      (e) => (e.payload as Record<string, unknown>).reason === "noncompromise",
    );
    assert.equal(noncompSuppressed.length, 2);

    const ids = noncompSuppressed.map((e) => (e.payload as Record<string, unknown>).agent_id);
    assert.ok(ids.includes("agent-X"));
    assert.ok(ids.includes("agent-Y"));

    // No winner_id on noncompromise suppressions
    for (const e of noncompSuppressed) {
      assert.equal((e.payload as Record<string, unknown>).winner_id, undefined);
    }

    log.close();
  });

  it("conflict count resets after noncompromise — subsequent conflicts restart from round 1", async () => {
    const { log, bus } = await makeEnv();
    createConflictResolver({ noncompromiseThreshold: 2 }).connect(bus);

    const noncomp = collect(bus, "conflict.noncompromise");

    // Trigger noncompromise
    emitConflict(bus, "agent-A", "agent-B", "BlockReset", 0.5, 0.5);
    await new Promise((r) => setTimeout(r, 20));
    emitConflict(bus, "agent-A", "agent-B", "BlockReset", 0.5, 0.5);
    await new Promise((r) => setTimeout(r, 50));

    assert.equal(noncomp.length, 1);

    // After reset, a single new conflict should NOT trigger noncompromise
    emitConflict(bus, "agent-A", "agent-B", "BlockReset", 0.5, 0.5);
    await new Promise((r) => setTimeout(r, 50));

    assert.equal(noncomp.length, 1, "should not fire noncompromise again after reset");

    log.close();
  });

  it("default threshold is 3", async () => {
    const { log, bus } = await makeEnv();
    createConflictResolver().connect(bus);  // no opts → default threshold = 3

    const noncomp = collect(bus, "conflict.noncompromise");

    emitConflict(bus, "a1", "a2", "T", 0.5, 0.5);
    await new Promise((r) => setTimeout(r, 10));
    emitConflict(bus, "a1", "a2", "T", 0.5, 0.5);
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(noncomp.length, 0, "should not fire before round 3");

    emitConflict(bus, "a1", "a2", "T", 0.5, 0.5);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(noncomp.length, 1, "should fire on round 3");

    log.close();
  });

  it("conflict.noncompromise agent_ids are sorted alphabetically", async () => {
    const { log, bus } = await makeEnv();
    createConflictResolver({ noncompromiseThreshold: 1 }).connect(bus);

    const noncomp = collect(bus, "conflict.noncompromise");

    emitConflict(bus, "z-agent", "a-agent", "BlockSort", 0.5, 0.5);
    await new Promise((r) => setTimeout(r, 50));

    assert.equal(noncomp.length, 1);
    const ids = (noncomp[0].payload as Record<string, unknown>).agent_ids as string[];
    assert.equal(ids[0], "a-agent");
    assert.equal(ids[1], "z-agent");

    log.close();
  });

  it("different agent pairs over same terminal tracked independently", async () => {
    const { log, bus } = await makeEnv();
    createConflictResolver({ noncompromiseThreshold: 3 }).connect(bus);

    const noncomp = collect(bus, "conflict.noncompromise");

    // A vs B: 2 rounds (below threshold)
    emitConflict(bus, "agent-A", "agent-B", "TermK", 0.9, 0.5);
    await new Promise((r) => setTimeout(r, 10));
    emitConflict(bus, "agent-A", "agent-B", "TermK", 0.9, 0.5);
    await new Promise((r) => setTimeout(r, 10));

    // C vs D: 1 round (below threshold)
    emitConflict(bus, "agent-C", "agent-D", "TermK", 0.9, 0.5);
    await new Promise((r) => setTimeout(r, 50));

    assert.equal(noncomp.length, 0, "no pair has reached threshold");

    log.close();
  });
});
