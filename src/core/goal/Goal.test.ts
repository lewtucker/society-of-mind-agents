import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventLog } from "../event-log/EventLog.ts";
import { PolynemeBus } from "../polyneme-bus/PolynemeBus.ts";
import { ContextStore } from "../context/ContextStore.ts";
import { GoalStore } from "./GoalStore.ts";
import { detectGaps, createGoalAgent, setGoal } from "./engine.ts";
import type { SignalEnvelope } from "../event-log/types.ts";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

let tmpDir:    string;
let goalStore: GoalStore;

before(async () => {
  tmpDir    = await mkdtemp(join(tmpdir(), "som-goal-test-"));
  goalStore = GoalStore.open(join(tmpDir, "goals.db"));
});

after(async () => {
  goalStore.close();
  await rm(tmpDir, { recursive: true });
});

async function makeEnv() {
  const log = EventLog.open(join(tmpDir, `events-${Date.now()}.db`));
  const ctx = new ContextStore();
  const bus = new PolynemeBus(log, ctx);
  return { log, ctx, bus };
}

function collect(bus: PolynemeBus, signal: string): SignalEnvelope[] {
  const received: SignalEnvelope[] = [];
  bus.subscribe({ id: `spy-${signal}-${Date.now()}`, signals: [signal], onSignal: (e) => received.push(e) });
  return received;
}

// ─── detectGaps unit tests ─────────────────────────────────────────────────────

describe("detectGaps", () => {

  it("returns empty when desired matches current exactly", () => {
    const gaps = detectGaps(
      { BlockA: "tower-top", BlockB: "on-BlockA" },
      { BlockA: "tower-top", BlockB: "on-BlockA" },
    );
    assert.equal(gaps.length, 0);
  });

  it("returns a gap for each mismatched terminal", () => {
    const gaps = detectGaps(
      { BlockA: "tower-top", BlockB: "on-BlockA" },
      { BlockA: "table",     BlockB: "table" },
    );
    assert.equal(gaps.length, 2);
    const names = gaps.map((g) => g.terminal);
    assert.ok(names.includes("BlockA"));
    assert.ok(names.includes("BlockB"));
  });

  it("gap carries desired and current values", () => {
    const [gap] = detectGaps(
      { BlockA: "tower-top" },
      { BlockA: "table" },
    );
    assert.equal(gap.terminal, "BlockA");
    assert.equal(gap.desired,  "tower-top");
    assert.equal(gap.current,  "table");
  });

  it("current undefined → gap with current=undefined", () => {
    const [gap] = detectGaps({ BlockA: "tower-top" }, {});
    assert.equal(gap.terminal, "BlockA");
    assert.equal(gap.current,  undefined);
  });

  it("terminals absent from desired are unconstrained — no gap", () => {
    const gaps = detectGaps(
      { BlockA: "tower-top" },
      { BlockA: "tower-top", BlockB: "anywhere" },
    );
    assert.equal(gaps.length, 0);
  });

  it("null desired value matches null current value — no gap", () => {
    const gaps = detectGaps({ BlockA: null }, { BlockA: null });
    assert.equal(gaps.length, 0);
  });

  it("desired null vs current undefined → gap (null ≠ undefined)", () => {
    const [gap] = detectGaps({ BlockA: null }, {});
    assert.equal(gap.desired, null);
    assert.equal(gap.current, undefined);
  });
});

// ─── GoalStore tests ──────────────────────────────────────────────────────────

describe("GoalStore", () => {

  it("write returns a ULID", () => {
    const id = goalStore.write({
      description: "Stack all blocks",
      frame_id:    null,
      desired:     { BlockA: "tower-top" },
    });
    assert.ok(id.length > 0);
  });

  it("getById returns the goal with active=true", () => {
    const id = goalStore.write({
      description: "Get block to table",
      frame_id:    null,
      desired:     { BlockA: "table" },
    });
    const goal = goalStore.getById(id);
    assert.ok(goal !== null);
    assert.equal(goal.active, true);
    assert.deepEqual(goal.desired, { BlockA: "table" });
  });

  it("setActive false marks goal inactive", () => {
    const id = goalStore.write({
      description: "Temp goal",
      frame_id: null,
      desired: { x: 1 },
    });
    goalStore.setActive(id, false);
    const goal = goalStore.getById(id);
    assert.equal(goal!.active, false);
  });

  it("listActive returns only active goals", () => {
    const store = GoalStore.open(join(tmpDir, "goals-list-test.db"));
    const id1 = store.write({ description: "G1", frame_id: null, desired: { a: 1 } });
    const id2 = store.write({ description: "G2", frame_id: null, desired: { b: 2 } });
    store.setActive(id1, false);

    const active = store.listActive();
    assert.ok(!active.some((g) => g.id === id1));
    assert.ok(active.some((g) => g.id === id2));
    store.close();
  });
});

// ─── createGoalAgent integration tests ────────────────────────────────────────

describe("createGoalAgent", () => {

  it("goal.set triggers gap detection and emits goal.gap for each open terminal", async () => {
    const { log, bus } = await makeEnv();
    const agent  = createGoalAgent(goalStore);
    agent.connect(bus);

    const gaps = collect(bus, "goal.gap");

    const goal_id = setGoal(bus, goalStore, {
      description: "Place block on tower",
      frame_id:    null,
      desired:     { BlockA: "tower-top", BlockB: "on-BlockA" },
    });

    await new Promise((r) => setTimeout(r, 50));

    assert.ok(gaps.length >= 2, "should emit goal.gap for each unfilled terminal");
    const terminals = gaps.map((e) => (e.payload as Record<string, unknown>).terminal);
    assert.ok(terminals.includes("BlockA"));
    assert.ok(terminals.includes("BlockB"));
    const payloads = gaps.map((e) => e.payload as Record<string, unknown>);
    assert.ok(payloads.every((p) => p.goal_id === goal_id));

    log.close();
  });

  it("setGoal emits goal.set signal on the bus", async () => {
    const { log, bus } = await makeEnv();
    createGoalAgent(goalStore).connect(bus);

    const goalSetEvents = collect(bus, "goal.set");

    setGoal(bus, goalStore, {
      description: "Verify goal.set signal",
      frame_id:    null,
      desired:     { x: 1 },
    });

    await new Promise((r) => setTimeout(r, 50));
    assert.ok(goalSetEvents.length >= 1);

    log.close();
  });

  it("goal.achieved fires immediately when desired is already satisfied", async () => {
    const { log, bus } = await makeEnv();
    const agent = createGoalAgent(goalStore);
    agent.connect(bus);

    // First push current state
    bus.emit({
      source: "test", signal: "state.updated", type: "polyneme",
      payload: { terminals: { BlockA: "tower-top" } },
      context: { pronomes: {}, frame_id: null, kline_ids: [], micronemes: [] },
      causedBy: null,
    });

    await new Promise((r) => setTimeout(r, 50));

    const achieved = collect(bus, "goal.achieved");

    const goal_id = setGoal(bus, goalStore, {
      description: "Block already in place",
      frame_id:    null,
      desired:     { BlockA: "tower-top" },
    });

    await new Promise((r) => setTimeout(r, 50));

    assert.ok(achieved.length >= 1, "should emit goal.achieved when no gaps");
    assert.equal((achieved[0].payload as Record<string, unknown>).goal_id, goal_id);

    // Goal should be marked inactive in store
    const goal = goalStore.getById(goal_id);
    assert.equal(goal!.active, false);

    log.close();
  });

  it("state.updated closes gaps and emits goal.achieved", async () => {
    const { log, bus } = await makeEnv();
    const agent = createGoalAgent(goalStore);
    agent.connect(bus);

    const achieved = collect(bus, "goal.achieved");

    const goal_id = setGoal(bus, goalStore, {
      description: "Move block to shelf",
      frame_id:    null,
      desired:     { BlockC: "shelf" },
    });

    await new Promise((r) => setTimeout(r, 50));

    // Now update state to match desired
    bus.emit({
      source: "test", signal: "state.updated", type: "polyneme",
      payload: { terminals: { BlockC: "shelf" } },
      context: { pronomes: {}, frame_id: null, kline_ids: [], micronemes: [] },
      causedBy: null,
    });

    await new Promise((r) => setTimeout(r, 50));

    assert.ok(achieved.length >= 1, "should achieve goal after state.updated satisfies it");
    assert.equal((achieved[0].payload as Record<string, unknown>).goal_id, goal_id);

    const goal = goalStore.getById(goal_id);
    assert.equal(goal!.active, false, "goal should be deactivated in store");

    log.close();
  });

  it("gap.closed one terminal at a time — goal.achieved only when all gaps closed", async () => {
    const { log, bus } = await makeEnv();
    const agent = createGoalAgent(goalStore);
    agent.connect(bus);

    const achieved = collect(bus, "goal.achieved");
    const gaps     = collect(bus, "goal.gap");

    const goal_id = setGoal(bus, goalStore, {
      description: "Close gaps incrementally",
      frame_id:    null,
      desired:     { X: "a", Y: "b" },
    });

    await new Promise((r) => setTimeout(r, 50));

    // Close first gap
    bus.emit({
      source: "test", signal: "gap.closed", type: "polyneme",
      payload: { goal_id, terminal: "X", value: "a" },
      context: { pronomes: {}, frame_id: null, kline_ids: [], micronemes: [] },
      causedBy: null,
    });

    await new Promise((r) => setTimeout(r, 50));
    assert.equal(achieved.length, 0, "should not achieve yet — Y still open");

    // Close second gap
    bus.emit({
      source: "test", signal: "gap.closed", type: "polyneme",
      payload: { goal_id, terminal: "Y", value: "b" },
      context: { pronomes: {}, frame_id: null, kline_ids: [], micronemes: [] },
      causedBy: null,
    });

    await new Promise((r) => setTimeout(r, 50));
    assert.ok(achieved.length >= 1, "should achieve after all gaps closed");

    void gaps;
    log.close();
  });

  it("gap.closed for unknown goal_id is silently ignored", async () => {
    const { log, bus } = await makeEnv();
    createGoalAgent(goalStore).connect(bus);

    const achieved = collect(bus, "goal.achieved");

    bus.emit({
      source: "test", signal: "gap.closed", type: "polyneme",
      payload: { goal_id: "01NONEXISTENT000000000000", terminal: "X", value: "a" },
      context: { pronomes: {}, frame_id: null, kline_ids: [], micronemes: [] },
      causedBy: null,
    });

    await new Promise((r) => setTimeout(r, 50));
    assert.equal(achieved.length, 0);
    log.close();
  });

  it("multiple active goals are tracked independently", async () => {
    const { log, bus } = await makeEnv();
    const agent = createGoalAgent(goalStore);
    agent.connect(bus);

    const achieved = collect(bus, "goal.achieved");

    const goal1 = setGoal(bus, goalStore, {
      description: "Goal 1", frame_id: null, desired: { P: "x" },
    });
    const goal2 = setGoal(bus, goalStore, {
      description: "Goal 2", frame_id: null, desired: { Q: "y" },
    });

    await new Promise((r) => setTimeout(r, 50));

    // Achieve only goal1
    bus.emit({
      source: "test", signal: "gap.closed", type: "polyneme",
      payload: { goal_id: goal1, terminal: "P", value: "x" },
      context: { pronomes: {}, frame_id: null, kline_ids: [], micronemes: [] },
      causedBy: null,
    });

    await new Promise((r) => setTimeout(r, 50));

    assert.equal(achieved.length, 1);
    assert.equal((achieved[0].payload as Record<string, unknown>).goal_id, goal1);

    // goal2 still active
    const g2 = goalStore.getById(goal2);
    assert.equal(g2!.active, true);

    log.close();
  });

  it("goal.gap payload includes goal_id, terminal, desired, and current", async () => {
    const { log, bus } = await makeEnv();
    createGoalAgent(goalStore).connect(bus);

    const gaps = collect(bus, "goal.gap");

    const goal_id = setGoal(bus, goalStore, {
      description: "Check gap payload shape",
      frame_id:    null,
      desired:     { Arm: "extended" },
    });

    await new Promise((r) => setTimeout(r, 50));

    assert.ok(gaps.length >= 1);
    const p = gaps[0].payload as Record<string, unknown>;
    assert.equal(p.goal_id,  goal_id);
    assert.equal(p.terminal, "Arm");
    assert.equal(p.desired,  "extended");
    assert.equal(p.current,  undefined);

    log.close();
  });

  it("goal.achieved is caused by the triggering signal", async () => {
    const { log, bus } = await makeEnv();
    createGoalAgent(goalStore).connect(bus);

    const achieved = collect(bus, "goal.achieved");

    // Set current state first so goal is immediately satisfied
    bus.emit({
      source: "test", signal: "state.updated", type: "polyneme",
      payload: { terminals: { Z: "done" } },
      context: { pronomes: {}, frame_id: null, kline_ids: [], micronemes: [] },
      causedBy: null,
    });
    await new Promise((r) => setTimeout(r, 20));

    const triggerId = bus.emit({
      source: "goal-manager", signal: "goal.set", type: "polyneme",
      payload: { goal_id: goalStore.write({ description: "causal test", frame_id: null, desired: { Z: "done" } }) },
      context: { pronomes: {}, frame_id: null, kline_ids: [], micronemes: [] },
      causedBy: null,
    });

    await new Promise((r) => setTimeout(r, 50));

    assert.ok(achieved.length >= 1);
    assert.equal(achieved[0].causedBy, triggerId, "goal.achieved should be caused by goal.set");

    log.close();
  });
});
