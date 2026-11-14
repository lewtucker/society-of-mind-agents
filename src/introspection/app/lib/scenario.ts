import type { AgentDef, AgentState, AgentStatus, SocietyEvent, Snapshot } from "../types";

// ─── Agent registry ───────────────────────────────────────────────────────────

export const AGENTS: AgentDef[] = [
  // B-Brain layer — always watching, never dormant
  { id: "confusion-detector", name: "ConfusionDetector", layer: "b-brain", description: "Spots agents cycling or stuck" },
  { id: "conflict-monitor",   name: "ConflictMonitor",   layer: "b-brain", description: "Detects prolonged agent disagreements" },
  { id: "progress-tracker",   name: "ProgressTracker",   layer: "b-brain", description: "Monitors difference-engine convergence" },
  // Agency layer
  { id: "goal-manager",   name: "GoalManager",   layer: "agency", description: "Difference-engines driving toward objectives" },
  { id: "memory-manager", name: "MemoryManager", layer: "agency", description: "K-line creation, retrieval, level-banding" },
  { id: "frame-selector", name: "FrameSelector", layer: "agency", description: "Matches situations to best-fit frames" },
  // Agent layer — LLM-backed specialists
  { id: "builder", name: "Builder", layer: "agent", description: "Sequences block-stacking sub-tasks" },
  { id: "find",    name: "Find",    layer: "agent", description: "Locates available blocks" },
  { id: "grasp",   name: "Grasp",   layer: "agent", description: "Grips the target block" },
  { id: "move",    name: "Move",    layer: "agent", description: "Plans path to destination" },
  { id: "put",     name: "Put",     layer: "agent", description: "Places block at destination" },
  { id: "see",     name: "See",     layer: "agent", description: "Parses scene, extracts objects" },
];

export const AGENT_IDS = AGENTS.map((a) => a.id);

// ─── Scenario definition ──────────────────────────────────────────────────────

type StateMap = Partial<Record<string, AgentState>>;

interface Frame {
  states: StateMap;
  event: Omit<SocietyEvent, "id" | "timestamp"> | null;
  durationMs: number;
}

const W: StateMap = {
  "confusion-detector": "watching",
  "conflict-monitor":   "watching",
  "progress-tracker":   "watching",
};

// All agents dormant, B-brains watching
const D: StateMap = {
  ...W,
  "goal-manager": "dormant", "memory-manager": "dormant", "frame-selector": "dormant",
  "builder": "dormant", "find": "dormant", "grasp": "dormant",
  "move": "dormant", "put": "dormant", "see": "dormant",
};

// Helper to keep event definitions brief
const ev = (
  source: string, signal: string, type: SocietyEvent["type"], summary: string, causedBy: string | null = null
): Omit<SocietyEvent, "id" | "timestamp"> => ({ source, signal, type, summary, causedBy });

// Block-builder scenario: building a tower of height 3
// Demonstrates concurrent activation, K-line retrieval, and censor firing
const SCENARIO: Frame[] = [
  // ── Idle ──────────────────────────────────────────────────────────────────
  { states: D, event: null, durationMs: 1600 },

  // ── Goal set ──────────────────────────────────────────────────────────────
  {
    states: { ...D, "goal-manager": "active" },
    event: ev("goal-manager", "goal.set", "activation", "Goal set: build tower(height=3)"),
    durationMs: 1000,
  },
  {
    states: { ...D, "frame-selector": "active" },
    event: ev("frame-selector", "frame.selected", "activation", "Frame selected: Builder (confidence=0.94)"),
    durationMs: 900,
  },

  // ── Step 1: find & place Block A ──────────────────────────────────────────
  {
    states: { ...D, "builder": "active" },
    event: ev("builder", "builder.step", "activation", "Builder activated — step 1 / 3"),
    durationMs: 800,
  },
  {
    states: { ...D, "find": "active", "see": "active" },
    event: ev("builder", "block.search", "polyneme", "Polyneme → Find, See: locate available block"),
    durationMs: 1100,
  },
  {
    states: { ...D },
    event: ev("find", "block.found", "polyneme", "Block A located at (2, 0)"),
    durationMs: 600,
  },
  // Concurrent activation — both Grasp and Move fire on block.found
  {
    states: { ...D, "grasp": "active", "move": "active" },
    event: ev("find", "block.found", "polyneme", "→ Grasp, Move activated concurrently"),
    durationMs: 1200,
  },
  {
    states: { ...D, "move": "active" },
    event: ev("grasp", "grip.ready", "polyneme", "Grip confirmed on Block A"),
    durationMs: 600,
  },
  {
    states: { ...D },
    event: ev("move", "path.planned", "polyneme", "Path to tower top computed"),
    durationMs: 600,
  },
  {
    states: { ...D, "put": "active" },
    event: ev("put", "put.execute", "activation", "Placing Block A on base"),
    durationMs: 1000,
  },
  {
    states: { ...D, "memory-manager": "active" },
    event: ev("memory-manager", "kline.capture", "activation", "K-line captured: step.success (band=core, confidence=1.0)"),
    durationMs: 1000,
  },

  // ── Step 2: K-line retrieval assists ─────────────────────────────────────
  {
    states: { ...D, "builder": "active" },
    event: ev("builder", "builder.step", "activation", "Builder activated — step 2 / 3"),
    durationMs: 700,
  },
  {
    states: { ...D, "find": "active", "see": "active", "memory-manager": "active" },
    event: ev("memory-manager", "kline.retrieve", "activation", "K-line retrieved: step.success (score=0.91, age=0d)"),
    durationMs: 900,
  },
  {
    states: { ...D },
    event: ev("find", "block.found", "polyneme", "Block B located — memory-assisted, faster"),
    durationMs: 600,
  },
  {
    states: { ...D, "grasp": "active", "move": "active" },
    event: ev("find", "block.found", "polyneme", "→ Grasp, Move activated concurrently"),
    durationMs: 1000,
  },
  {
    states: { ...D, "put": "active" },
    event: ev("put", "put.execute", "activation", "Placing Block B on Block A"),
    durationMs: 900,
  },
  {
    states: { ...D, "memory-manager": "active" },
    event: ev("memory-manager", "kline.capture", "activation", "K-line captured: step.success (fringe promoted → peripheral)"),
    durationMs: 800,
  },

  // ── Step 3: Censor fires (block already in tower) ─────────────────────────
  {
    states: { ...D, "builder": "active", "memory-manager": "active" },
    event: ev("builder", "builder.step", "activation", "Builder activated — step 3 / 3"),
    durationMs: 700,
  },
  {
    states: { ...D, "find": "active", "memory-manager": "active" },
    event: ev("find", "block.search", "polyneme", "Candidate: Block C (already in tower?)"),
    durationMs: 900,
  },
  // Censor fires — Block C is already in the tower
  {
    states: { ...D, "find": "active", "memory-manager": "active" },
    event: ev("memory-manager", "censor.fire", "censor", "CENSOR: Block C already in tower — action blocked"),
    durationMs: 1100,
  },
  {
    states: { ...D, "find": "active" },
    event: ev("find", "block.found", "polyneme", "Block D located (C skipped by censor)"),
    durationMs: 800,
  },
  {
    states: { ...D, "grasp": "active", "move": "active" },
    event: ev("find", "block.found", "polyneme", "→ Grasp, Move — final block"),
    durationMs: 1000,
  },
  {
    states: { ...D, "put": "active" },
    event: ev("put", "put.execute", "activation", "Placing Block D — tower complete"),
    durationMs: 900,
  },

  // ── Goal achieved + final K-line ──────────────────────────────────────────
  {
    states: { ...D, "goal-manager": "active", "memory-manager": "active" },
    event: ev("goal-manager", "goal.achieved", "activation", "Goal achieved: tower(height=3) complete"),
    durationMs: 1200,
  },
  {
    states: { ...D, "memory-manager": "active" },
    event: ev("memory-manager", "kline.capture", "activation", "K-line captured: full build sequence (3 stored total)"),
    durationMs: 1100,
  },

  // ── Return to idle ────────────────────────────────────────────────────────
  { states: D, event: null, durationMs: 2000 },
];

// ─── Snapshot builder ─────────────────────────────────────────────────────────

// Activation counts persist across the lifetime of the server process
const counts: Record<string, number> = Object.fromEntries(AGENT_IDS.map((id) => [id, 0]));
let seq = 0;

const PAUSED_FRAME: Frame = {
  states: D,
  event: null,
  durationMs: 5000, // poll slowly while paused
};

export function getScenarioLength(): number { return SCENARIO.length; }

export function getFrame(tick: number): { snapshot: Snapshot; durationMs: number } {
  // After the last frame, hold the final idle state — don't loop.
  // The society has completed its run; the user can query what was learned.
  const frame = tick < SCENARIO.length ? SCENARIO[tick] : PAUSED_FRAME;

  const statuses: Record<string, AgentStatus> = {};
  for (const id of AGENT_IDS) {
    const state = (frame.states[id] ?? "dormant") as AgentState;
    if (state === "active") counts[id]++;
    statuses[id] = {
      agentId: id,
      state,
      lastSignal: frame.event?.source === id ? frame.event.signal : null,
      activationCount: counts[id],
    };
  }

  const event: SocietyEvent | null = frame.event
    ? { ...frame.event, id: `evt-${++seq}`, timestamp: Date.now() }
    : null;

  return {
    snapshot: { mode: "OBSERVE", statuses, event, tick, paused: tick >= SCENARIO.length },
    durationMs: frame.durationMs,
  };
}
