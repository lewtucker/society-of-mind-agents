---
title: "Implementation Plan"
version: "1.0"
date: 2026-04-01
author: Lew Tucker
status: Living
document-id: SOM-PLAN
changelog:
  - version: "1.0"
    date: 2026-04-01
    summary: Initial plan — reflects Phase 0 and 1.1 complete, covers all remaining phases
---

# Society of Mind — Implementation Plan

This document is the master build-order guide. Each phase produces a stable, runnable, testable artifact before the next phase begins. No speculative abstractions — only build what the next phase requires.

**Reference docs:**
- `ARCHITECTURE.md` — concept-to-software mapping, component designs
- `KLINE_MEMORY.md` — K-line schema, capture/retrieval/consolidation workflows
- `OBSERVE_AND_CONTROL.md` — OBSERVE/ACT modes, query interface, action tiers

---

## Status Snapshot

| Phase | Component | Status |
|---|---|---|
| 0.1 | Event log | ✅ complete |
| 0.2 | Polyneme bus | ✅ complete |
| 0.3 | Introspection app | ✅ complete |
| 1.1 | Agent base class | ✅ complete |
| 1.2 | Agency container | ⬜ next |
| 1.3 | Context store | ⬜ |
| 1.4 | Query interface | ⬜ |
| 2.1 | K-line schema + SQLite | ⬜ |
| 2.2 | Positive capture + retrieval | ⬜ |
| 2.3 | Censor/suppressor capture | ⬜ |
| 2.4 | Memory probe query | ⬜ |
| 3.1 | Frame schema + storage | ⬜ |
| 3.2 | Frame matching + slot-filling | ⬜ |
| 3.3 | Trans-frames + frame-arrays | ⬜ |
| 4.1 | Difference-engine | ⬜ |
| 4.2 | Cross-exclusion + noncompromise | ⬜ |
| 4.3 | Censor/suppressor guards | ⬜ |
| 4.4 | B-brain observer agent | ⬜ |
| 5.1 | Block-builder demo society | ⬜ |
| 5.2 | Conversational agent | ⬜ |

---

## Phase 0 — Observation Foundation ✅

> **Goal**: Append-only event bus + real-time viewer. Everything observable from day one.

Rationale: You cannot validate memory without observation. Build observability before agents, not after.

### 0.1 Event Log (`src/core/event-log/`) ✅

SQLite-backed, ULID-ordered, append-only. The ground truth for the entire society's behavior.

**Key decisions made:**
- `monotonicFactory()` from `ulid` (not plain `ulid()`) — guarantees lexicographic ordering within the same millisecond
- WAL mode + `synchronous = NORMAL` — concurrent readers while writer is active
- Prepared statements for all hot paths — no string-building on emit
- `tail(opts)` polls on interval, returns stop function — no streaming dependency
- `recent(limit, since?)` for initial page loads

**Files:** `event-log/EventLog.ts`, `event-log/schema.ts`, `event-log/types.ts`
**Tests:** 7 tests — ordering, causedBy links, JSON round-trip, WAL mode

### 0.2 Polyneme Bus (`src/core/polyneme-bus/`) ✅

Pub/sub with glob patterns, isonome broadcast, pronome bindings, async fan-out.

**Key decisions made:**
- `queueMicrotask` for fan-out — throwing subscribers never block the emitter or other subscribers
- Glob matching: `"block.*"` matches `"block.found"`, `"block.search"`, etc.
- `emitIsonome()` bypasses all topic filters — uniform system-wide effect
- `bindPronome()` / `releasePronome()` log `pronome-bind` events to the audit trail

**Files:** `polyneme-bus/PolynemeBus.ts`
**Tests:** 9 tests — concurrent activation, isonome bypass, type filter, pronome injection, throwing subscriber isolation

### 0.3 Introspection App (`src/introspection/`) ✅

Next.js 16 app. Dual-mode SSE: streams real `~/.som/events.db` if present, falls back to 25-frame block-stacking simulation.

**Key decisions made:**
- `EventLogReader` opens DB with `readonly: true` — B-Brain principle, observer never writes
- `EventLogReader.tryOpen()` returns null if DB absent — route switches modes automatically
- Simulation does not loop — pauses at end (amber dot, "run complete") so state can be examined
- `serverExternalPackages: ["better-sqlite3"]` in next.config.ts — native addon cannot be bundled

**Files:** `app/api/events/route.ts`, `app/lib/EventLogReader.ts`, `app/lib/scenario.ts`, `app/components/SocietyView.tsx`

---

## Phase 1 — Foundation

> **Goal**: Working agents on the bus, connected and observable, in OBSERVE mode. No K-line memory yet — just agents reasoning and emitting signals, fully traceable.

### 1.1 Agent Base Class (`src/core/agent/`) ✅

**Minsky concept**: Agent — specialized reasoner, ignorant of the larger picture.

**What was built:**
- `Agent` class: deterministic handler OR LLM-backed (Claude Haiku default via `@anthropic-ai/sdk`)
- Built-in `emit_signal` tool present on all agents — the only way LLM agents communicate back to the society
- Domain tools intercepted in OBSERVE mode → logged as `tool_intent` signals, not executed
- Stub mode when `ANTHROPIC_API_KEY` absent → `agent.stub` signal (infrastructure works, reasoning skipped)
- `connect(bus)` subscribes + emits `agent.active`, returns `disconnect()` which emits `agent.dormant`
- Per-agent error catching → `agent.error` signal, bus never crashes

**Files:** `agent/Agent.ts`, `agent/types.ts`
**Tests:** 8 tests — lifecycle, deterministic dispatch, context/pronome injection, causedBy chain, stub mode, concurrent activation (3 agents from 1 polyneme), error isolation

---

### 1.2 Agency Container ⬜ — NEXT

**Minsky concept**: Agency — group of agents viewed as unified capability from outside.

**Why now**: Agents in isolation cannot form a society. Agency is the organizational unit — a society-wide polyneme fan-out is meaningless unless agents are grouped into cooperating sub-societies.

**What to build** in `src/core/agency/`:

```
Agency
  ├── members: Map<string, Agent | Agency>   // agents or nested agencies
  ├── connect(bus): () => void               // connects all members, emits agency.active
  ├── disconnect(): void                     // disconnects all, emits agency.dormant
  └── (signals routed internally by member subscriptions — no explicit router needed)
```

**AgencyOptions:**
```typescript
interface AgencyOptions {
  id: string;
  name: string;
  members: Array<Agent | Agency>;
  // Optional: signals the agency itself listens to (in addition to members)
  signals?: string[];
}
```

**Signals emitted:**
- `agency.active` — on connect, with `{ name, memberCount, memberIds }`
- `agency.dormant` — on disconnect
- `agency.member.error` — if a member fails to connect

**Behavior:**
- All members share the same bus — they communicate peer-to-peer via polyneme signals
- The Agency is a container and lifecycle manager, not a router
- Nested agencies work recursively (`connect()` calls down the tree)
- Disconnecting an Agency disconnects all members

**Acceptance criteria:**
- One `agency.active` signal with `memberCount` when connected
- Member agents each emit their own `agent.active` signals
- One polyneme can fan-out to multiple agents within the agency simultaneously
- Disconnecting the agency disconnects all members and emits `agency.dormant`
- A throwing member does not prevent other members from connecting

**Tests to write:**
1. `connect()` emits `agency.active` and all member `agent.active` signals
2. `disconnect()` emits `agency.dormant` and all `agent.dormant` signals
3. One polyneme reaches all subscribing members simultaneously
4. Nested agency: connecting parent connects grandchildren
5. Member connect error does not prevent other members from connecting
6. Agency reports correct `memberCount`

---

### 1.3 Context Store ⬜

**Minsky concept**: Pronomes (temporary role bindings) + Micronemes (contextual shading). Currently pronomes live on `PolynemeBus` — this phase extracts them into a proper context store and adds microneme support.

**Why now**: Agents need to know who the current Actor is, what the active Goal is, what frame is in use. Pronomes on the bus work for simple cases, but the context store becomes critical once frames (Phase 3) exist.

**What to build** in `src/core/context/`:

```typescript
interface ContextStore {
  // Pronomes — temporary role bindings
  bind(role: string, agentId: string): void       // emits pronome-bind
  release(role: string): void                     // emits pronome-release
  getPronomes(): Readonly<Record<string, string>>

  // Active frame reference
  setFrame(frameId: string | null): void
  getFrame(): string | null

  // K-line references (which memories influenced current state)
  setActiveKLines(ids: string[]): void
  getActiveKLines(): string[]

  // Micronemes (contextual embedding vector — set by MemoryManager in Phase 2)
  setMicronemes(vec: number[]): void
  getMicronemes(): number[]

  // Snapshot (injected into every SignalEnvelope.context)
  snapshot(): SignalContext
}
```

**Integration**: `PolynemeBus` currently manages pronomes directly. In this phase, pronome management moves to `ContextStore`; `PolynemeBus` delegates to it. `SignalEnvelope.context` is populated from `ContextStore.snapshot()` on every emit.

**Acceptance criteria:**
- All pronome operations still emit events to the audit trail
- `bus.emit()` populates `envelope.context` from the store snapshot
- Pronome changes are immediately visible to agents activating after the bind
- ContextStore is injectable (for testing without a bus)

---

### 1.4 Query Interface ⬜

**Minsky concept**: B-Brain — observes the society and asks it questions without participating.

**Why now**: Before Phase 2 (K-line memory), you need to be able to ask the society what it currently knows and how it would respond to a situation — without triggering actual action. This is the validation mechanism for all memory work.

**What to build** in `src/core/query/` and a new API route in the introspection app:

**Query types** (from `OBSERVE_AND_CONTROL.md`):

| Query | What it does |
|---|---|
| `MEMORY_PROBE` | "What do you know about situation X?" — retrieves K-lines, returns ranked results |
| `REASONING_PROBE` | "How would you respond to signal X?" — runs agent dispatch in dry-run mode, returns `would_emit` list without actually emitting |
| `CENSOR_CHECK` | "Would any censor fire if agent A did action B in situation C?" — evaluates censor memories against a proposed action |
| `ACTIVATION_QUERY` | "Which agents are currently active/dormant?" — reads current bus state |
| `CAUSAL_TRACE` | "How did event E come to be?" — walks `causedBy` chain back to root |

**Introspection app addition**: A query panel that lets you type a natural-language question, maps it to the appropriate probe type, and displays the response. No K-line memory yet — `MEMORY_PROBE` returns empty until Phase 2.

**Acceptance criteria:**
- `REASONING_PROBE` runs agent handler in dry-run without writing to the bus
- `ACTIVATION_QUERY` reflects actual current agent states
- `CAUSAL_TRACE` returns the full causedBy chain for a given event id
- Query results appear in the introspection app

---

## Phase 2 — Memory

> **Goal**: K-line memory that accumulates across sessions and retrieves relevant past experience when similar situations recur. Validate with `MEMORY_PROBE` before proceeding.

**Minsky concept**: K-Line — "a mental state, a record of which agents were active when something worked."

Reference: `KLINE_MEMORY.md` for full data model, schema, and workflow.

### 2.1 K-Line Schema + SQLite Storage ⬜

**What to build** in `src/core/kline/`:

```typescript
// Core tables (see KLINE_MEMORY.md for full schema):
// - klines: id, type, situation_description, situation_embedding, frame_id, pronomes, realm, bands_json
// - kline_activations: kline_id, agent_id, signal, confidence, band
// - kline_hierarchy: parent_id, child_id
// - kline_source_events: kline_id, event_id
```

**Storage backend**: SQLite with `sqlite-vec` extension for vector similarity search. FTS5 for keyword search. Hybrid retrieval: 70% vector / 30% FTS, re-ranked with MMR (Maximal Marginal Relevance) to avoid redundant memories.

**Level-banding**: Each activation in a K-line is assigned to `core` (high confidence, persists), `peripheral` (moderate, decays slowly), or `fringe` (weak defaults, decays fast). Fringe fields serve as default assumptions — easily overridden when better info arrives.

**Acceptance criteria:**
- Can write and read K-lines across process restarts (persistence)
- ULID IDs maintain temporal order
- Level-band weights survive serialization/deserialization
- `KLineStore` opens read-only for introspection, read-write for MemoryManager only

### 2.2 Positive Capture + Retrieval ⬜

**Capture workflow** (triggered by `task.succeeded` signal):
1. Pull relevant event subsequence from EventLog (events with same `causedBy` chain)
2. Identify which agents were activated, with what signals
3. LLM call: generate a natural-language `situation_description` from the event subsequence
4. Embed the description → 1536-dim vector (OpenAI `text-embedding-3-small` or Anthropic equivalent)
5. Classify each activation into `core` / `peripheral` / `fringe` band
6. Write KLine record + activations

**Retrieval workflow** (triggered by new task or `MEMORY_PROBE`):
1. Embed the incoming situation description
2. Vector search: top-K nearest K-lines by cosine similarity
3. FTS search: keyword overlap with situation description
4. Merge results 70/30 vec/FTS, apply MMR to diversify
5. Apply temporal decay to fringe bands (older fringe entries weighted less)
6. Return ranked KLine list with confidence scores

**Acceptance criteria:**
- A successful block-placement emits a K-line with correct agent activations
- Retrieval of a similar situation returns the earlier K-line with score > 0.7
- Dissimilar situations do not retrieve the K-line (score < 0.3)
- `MEMORY_PROBE` query returns the retrieved K-lines in ranked order

### 2.3 Censor/Suppressor Capture ⬜

**Suppressor** (post-hoc): triggered when `task.failed` or `agent.error` with known-bad action. Records: pre-state pronomes + active frame + bad action + bad outcome.

**Censor** (pre-emptive): triggered when a suppressor has fired enough times that the system can generalize. LLM identifies the precursor pattern (what conditions precede the bad action). Censor memories are checked before actions, not after.

**Acceptance criteria:**
- Emitting a known-bad sequence creates a suppressor memory
- Attempting the same sequence again triggers a `censor.fired` signal before execution
- `CENSOR_CHECK` query evaluates a proposed action against the censor registry

### 2.4 Memory Probe Query + Memory Feedback Graph ⬜

Connect `MEMORY_PROBE` (stub in Phase 1.4) to the real K-line store. Add two new panels to the introspection app:

**Memory View panel:**
- Retrieved K-lines for the current task (ranked by score)
- Level-banding visualization (core/peripheral/fringe edges)
- Knowledge-tree hierarchy (parent/child K-lines)
- Censor memories that are currently active

**Memory Feedback Graph** — the core visualization for this system. A directed graph with two node types and three edge types:

```
Node types:
  ● Agent node     — circle, colored by current state (active/dormant/error)
  ⬡ K-line node   — hexagon, colored by type (positive/censor/abstract)

Edge types:
  agent ──signal──► agent      polyneme bus signal flow
  agent ──write───► K-line     MemoryManager captured this agent in this K-line
  K-line ──read───► agent      retrieval reactivates these agents
```

Level-banding maps to edge weight: core = thick solid, peripheral = medium, fringe = thin dashed. When retrieval fires, animate the read edges lighting up — the system reconstituting a past mental state. The write→read cycle (agents → K-line → agents) is intentionally visible: it IS the learning loop.

This graph answers at a glance: what has the society learned, from whom, and how strongly?

---

## Phase 3 — Knowledge

> **Goal**: Frame-based knowledge representation. Agents operate within structured knowledge templates with default assumptions, not raw context.

**Minsky concept**: Frames — "stereotypes drawn from experience, with default fillers for every slot."

### 3.1 Frame Schema + Storage ⬜

```typescript
interface Frame {
  id: string;                          // ULID
  name: string;                        // e.g. "BlockPlacement", "TowerConstruction"
  description: string;
  terminals: Record<string, Terminal>; // named slots
  parent_frame_id: string | null;      // frame inheritance
}

interface Terminal {
  name: string;
  type: "string" | "number" | "agent_id" | "frame_id" | "any";
  default_value: unknown;
  default_confidence: number;          // 0–1, how strongly to hold the default
  required: boolean;
}
```

Storage: SQLite table with JSON columns for terminals. Indexed by name for fast lookup.

**Acceptance criteria:**
- Frames persist across restarts
- Terminal defaults are accessible without a filler being set
- Frame inheritance: child frame inherits parent terminals, can override

### 3.2 Frame Matching + Slot-Filling ⬜

**Frame matching**: When a signal arrives, identify the best-matching frame based on signal name, payload shape, and active pronomes. Multiple candidates ranked by match score.

**Slot-filling order** (specificity wins over defaults):
1. Explicit payload values (highest confidence)
2. K-line retrieval results
3. Pronome bindings
4. Frame default values (lowest confidence)

**ContextStore integration**: `setFrame(frameId)` is called when a frame is selected; all subsequent signals carry the frame reference.

**Acceptance criteria:**
- `block.found` signal selects the `BlockPlacement` frame
- Unprovided terminals filled from frame defaults
- K-line retrieval overrides defaults when available
- Frame selection emits a `frame.selected` signal for audit trail

### 3.3 Trans-Frames + Frame-Arrays ⬜

**Trans-frame**: Action template binding pronome roles to a workflow step.
```typescript
interface TransFrame extends Frame {
  roles: {
    Actor:       string | null;    // who does it
    Action:      string;           // what happens
    Object:      string | null;    // what is acted on
    Origin:      string | null;    // starting state
    Destination: string | null;    // ending state
    Instrument:  string | null;    // tool used
  };
}
```

**Frame-array**: Multiple frames sharing the same terminal set, representing different perspectives (e.g., `BlockFromAbove`, `BlockFromSide`, `BlockAsTowerMember`).

**Acceptance criteria:**
- Trans-frame for `Grasp` binds `Actor=GraspAgent, Object=Block, Destination=GripPosition`
- Frame-array lets agents reason about the same block from multiple perspectives
- Switching between frames in a frame-array preserves shared terminal values

---

## Phase 4 — Goals and Control

> **Goal**: Goal-driven behavior (difference-engines), conflict resolution, and failure learning guards. The society can pursue a goal, encounter conflicts, resolve them, and remember not to make the same mistake twice.

### 4.1 Difference-Engine ⬜

**Minsky concept**: Goal = desired state + mechanism that persists until achieved.

**What to build**:
```typescript
interface Goal {
  id: string;
  description: string;
  desired_frame: Partial<Frame>;          // what the world should look like
  current_state_snapshot: Partial<Frame>; // what the world looks like now
  active: boolean;
  created_at: number;
}
```

**GoalManager agency**:
1. Holds the set of active goals
2. Periodically (or on `state.updated` signal) compares current vs. desired frames
3. For each difference, emits a `goal.gap` polyneme naming the gap
4. Agents subscribe to `goal.gap` and activate when they can close their relevant gap
5. Emits `goal.achieved` when all terminals match; `goal.failed` on timeout or censor block

**Acceptance criteria:**
- Setting a goal emits `goal.set` with desired state
- Gap detection emits `goal.gap` for each unfilled terminal
- Agents close gaps by emitting `gap.closed` signals
- `goal.achieved` fires when all gaps closed

### 4.2 Cross-Exclusion + Noncompromise ⬜

**Cross-exclusion**: Two agents competing for the same terminal cannot both be active simultaneously. The winner is determined by supervisor priority score.

**Noncompromise**: If two agents have been in conflict for > N rounds (configurable), suppress both and emit `conflict.noncompromise` — a different agency can try.

**ConflictResolver agency**:
- Monitors `agent.conflict` signals
- Applies priority rules to select winner
- Tracks conflict duration; fires noncompromise when threshold exceeded
- Emits `agent.suppressed` for both parties when noncompromise fires

**Acceptance criteria:**
- Two agents competing for the same block: lower-priority agent suppressed
- Sustained conflict (> threshold) triggers noncompromise with both suppressed
- Noncompromise fires `conflict.noncompromise` signal for audit trail

### 4.3 Censor/Suppressor Guards ⬜

Connect the censor/suppressor memories from Phase 2.3 to the execution path:

**Suppressors**: Evaluated after an action. If outcome matches a suppressor pattern, write a new censor entry.

**Censors**: Evaluated before an action (PreToolUse hook equivalent). If situation matches a censor precursor pattern, block and emit `censor.fired` with the reason.

**CensorRegistry agent**:
- Subscribes to `tool.intent` signals (OBSERVE mode intercepts)
- Evaluates each tool intent against the censor store
- Blocks and emits `censor.fired` if a match found
- Records new suppressor entries when bad outcomes are confirmed

**Acceptance criteria:**
- Tool intent for a known-bad action fires `censor.fired` before any effect
- `CENSOR_CHECK` query correctly identifies would-fire censors
- New failures accumulate as suppressors that become censors after N occurrences

### 4.4 B-Brain Observer Agent ⬜

**Minsky concept**: B-Brain — supervisory layer that observes the A-brain without domain knowledge, detects meta-level problems.

**What to build**: A special agent that subscribes to all signals (`"*"`) in read-only mode:

**Patterns to detect:**
| Pattern | Threshold | Action |
|---|---|---|
| Looping | Same signal emitted > 5 times from same source in 10s | Emit `bbrain.loop.detected` |
| Stall | No signals for > 30s while goal is active | Emit `bbrain.stall.detected` |
| Conflict spiral | Cross-exclusion battles > 3 rounds | Emit `bbrain.conflict.spiral` |
| Error burst | > 3 `agent.error` signals in 5s | Emit `bbrain.error.burst` |

The B-Brain never emits action signals — only observation signals. Nothing in the A-Brain is required to respond to B-Brain signals (but they appear in the audit trail and introspection app).

**Acceptance criteria:**
- B-Brain detects a simulated loop (5 same-signal emissions)
- B-Brain emits `bbrain.loop.detected` with the looping agent id
- B-Brain itself never appears as `source` in anything but `bbrain.*` signals
- Introspection app shows B-Brain alerts in a dedicated panel

---

## Phase 5 — Demo Society

> **Goal**: A working multi-agent society that solves a real problem, accumulates memory across sessions, uses that memory to improve on a second run, and fires a censor on a known-bad move.

### 5.1 Block-Builder Demo Society ⬜

Recreate Minsky's block-stacking scenario with real agents, frames, K-lines, and a censor.

**Agents:**
- `FindAgent` — scans environment for blocks, emits `block.found`
- `SeeAgent` — identifies block properties (size, color, position), emits `block.described`
- `GraspAgent` — picks up a block, emits `grip.ready`
- `MoveAgent` — moves block to target position, emits `block.placed`
- `PutAgent` — places block precisely, emits `placement.confirmed`

**Agencies:**
- `GetAgency` = [FindAgent, SeeAgent, GraspAgent] — finds and grabs a block
- `BuilderAgency` = [GetAgency, MoveAgent, PutAgency] — builds the tower

**K-line validation** (the core research question):
1. Run 1: Build a 3-block tower. Observe K-line capture.
2. Run 2: Build another tower. `MEMORY_PROBE` should retrieve Run 1 K-lines. Agents should activate faster on familiar steps.
3. Deliberately reuse a block already in the tower → censor should fire.

**Acceptance criteria:**
- Full audit trail for a complete tower build
- K-line captured after successful build
- Run 2 retrieves Run 1 K-lines with score > 0.7
- Censor fires when agent tries to reuse a tower block
- B-Brain detects nothing abnormal during a clean build

### 5.2 Conversational Agent ⬜

A society that can discuss topics across sessions, retrieving relevant past conversation K-lines.

**Scope** (Phase 5.2 is intentionally minimal — validate memory, not build a product):
- Single `ConversationAgency` with 3–5 agents (topic recognition, fact retrieval, response generation, memory capture)
- K-lines captured per conversation turn
- On second conversation about the same topic, earlier K-lines retrieved and referenced in response
- `MEMORY_PROBE` should surface past conversation context

**Acceptance criteria:**
- Ask about "block stacking" in session 1 → K-line captured
- Ask again in session 2 → K-line retrieved, response references it
- Introspection app shows retrieved memories in the Memory View panel

---

## Dependency Graph

```
Phase 0.1 Event Log
    └── Phase 0.2 Polyneme Bus
            └── Phase 0.3 Introspection App
                    └── Phase 1.1 Agent Base Class
                            └── Phase 1.2 Agency Container
                                    └── Phase 1.3 Context Store
                                            └── Phase 1.4 Query Interface
                                                    └── Phase 2.1 K-Line Schema
                                                            ├── Phase 2.2 Positive Capture/Retrieval
                                                            │       └── Phase 2.4 Memory Probe
                                                            └── Phase 2.3 Censor/Suppressor
                                                                    └── Phase 3.1 Frame Schema
                                                                            ├── Phase 3.2 Frame Matching
                                                                            │       └── Phase 3.3 Trans-Frames
                                                                            └── Phase 4.1 Difference-Engine
                                                                                    ├── Phase 4.2 Cross-Exclusion
                                                                                    ├── Phase 4.3 Censor Guards
                                                                                    └── Phase 4.4 B-Brain
                                                                                            └── Phase 5.1 Block-Builder
                                                                                                    └── Phase 5.2 Conversational
```

---

## Test Philosophy

Every phase must have tests before moving on.

- **Unit tests** — each component in isolation with a deterministic handler (no LLM calls)
- **Integration tests** — components wired together against a real in-memory SQLite DB
- **Stub mode** — LLM-backed agents testable without `ANTHROPIC_API_KEY` via `agent.stub` signal
- **No mocking the bus** — tests use a real `PolynemeBus` backed by a real `EventLog` in a temp dir

Run all tests:
```bash
cd src/core && npm test
# Currently: 24 tests across EventLog (7), PolynemeBus (9), Agent (8)
```

---

## Key Files

| What you need | Where to look |
|---|---|
| Full system design | `docs/ARCHITECTURE.md` |
| K-line data model | `docs/KLINE_MEMORY.md` |
| OBSERVE/ACT modes, query interface | `docs/OBSERVE_AND_CONTROL.md` |
| Block-stacking scenario walkthrough | `docs/Scenario-1-Block_Stacking.md` |
| All Minsky source concepts | `reference/society_of_mind.md` |
| Core package | `src/core/` |
| Introspection app | `src/introspection/` |
