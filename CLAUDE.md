# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

An agentic system with long-term memory inspired by Marvin Minsky's *Society of Mind* (1986). The core idea: intelligence emerges from the interaction of many specialized LLM-backed agents organized into societies with persistent memory, failure learning, and structured coordination. No central controller.

## Repository Structure

```
Society_of_Minds/
├── CLAUDE.md
├── docs/
│   ├── ARCHITECTURE.md          ← living copy (always latest)
│   ├── FEASIBILITY.md           ← living copy (always latest)
│   ├── KLINE_MEMORY.md          ← K-line memory subarchitecture (living)
│   ├── OBSERVE_AND_CONTROL.md   ← OBSERVE/ACT modes, query interface (living)
│   ├── Scenario-1-Block_Stacking.md  ← demo scenario walkthrough
│   ├── VERSIONING.md            ← versioning conventions
│   └── V1_0/                    ← frozen snapshot, 2026-03-24
│       ├── ARCHITECTURE_V1_0.md / .pdf / .html
│       └── FEASIBILITY_V1_0.md / .pdf / .html
├── reference/
│   ├── society_of_mind.md       ← complete book text
│   ├── table_of_contents.md
│   └── som_repo/                ← epub source (github.com/ttn114/societyofmind)
└── src/
    ├── core/                    ← @som/core package (Node.js, TypeScript, ESM)
    │   ├── event-log/           ← Phase 0.1: append-only SQLite event log
    │   ├── polyneme-bus/        ← Phase 0.2: pub/sub signal bus
    │   ├── agent/               ← Phase 1.1: Agent base class
    │   └── scripts/             ← emit-test.ts: seed ~/.som/events.db
    └── introspection/           ← Phase 0.3: Next.js 16 real-time viewer
```

## Documentation Versioning

All documentation lives under `docs/`. Living copies at the `docs/` root are always the latest. `docs/V{x}_{y}/` folders are frozen snapshots — never modify after creation. All docs include YAML frontmatter with version, date, author (Lew Tucker), status, and changelog. See `docs/VERSIONING.md` for full conventions.

## Key Minsky Concepts (must understand to work in this codebase)

- **Agent**: Specialized reasoner — LLM-backed, capable within its domain, ignorant of the larger picture
- **Agency**: Group of agents viewed as unified capability
- **K-Line**: Memory snapshot of which agents were active during success — the core memory mechanism
- **Frame**: Knowledge template with slots (terminals) and default fillers
- **Polyneme**: Event signal interpreted differently by each subscriber (pub/sub)
- **Pronome**: Temporary role binding (current Actor, Goal, etc.)
- **Difference-Engine**: Goal-driven loop comparing current vs desired state
- **Censor/Suppressor**: Guards that block known-bad patterns (failure learning)
- **B-Brain**: Supervisory meta-agent that observes without participating
- **Level-Band**: Confidence gradient in K-lines — strong core + weak fringes
- **Cross-Exclusion**: Mutual inhibition among competing agents (only one active)
- **Noncompromise**: When conflict persists, suppress both sides and try a third approach

## Architecture Principles

1. Agents are LLM-backed reasoners — each can think within its domain; the society provides what individuals lack (memory, coordination, failure learning)
2. No central controller — intelligence from agent interactions
3. Conflict is a feature — resolution via hierarchy, cross-exclusion, noncompromise
4. Memory is K-line snapshots — records which agents were active, not raw data
5. Defaults everywhere — frames pre-fill assumptions; specifics override weak defaults
6. Failure learning is first-class — censors/suppressors as important as positive memory
7. Each new layer builds on the previous stable layer
8. Agents don't share a common language — polyneme bus handles heterogeneous communication
9. Observable by default — every signal logged; introspection app is how we understand the system

## Design Decisions

- All architecture choices must map to specific Minsky concepts from the book
- When in doubt, reference `docs/ARCHITECTURE.md` for the concept-to-implementation mapping
- The book text at `reference/society_of_mind.md` is the authoritative source for concept definitions
- Each agent is an LLM-backed reasoner — capable within its domain, ignorant of the larger picture
- Decompose complex agents into sub-societies, but each sub-agent can still reason (it's not "mindless switches")

## Current Status

**Version**: V1.0 (2026-03-24)
**Phase**: Phase 5.2 complete — Conversational agent built and tested
**Next step**: Phase 6 — TBD (introspection app updates, or new demo)

## Phase 0 — Complete

- **0.1 Event log** (`src/core/event-log/`) — append-only SQLite, ULID ordering, WAL mode, `emit()` / `tail()` / `recent()`, `getById()`, `getActivationStates()`
- **0.2 Polyneme bus** (`src/core/polyneme-bus/`) — pub/sub with glob patterns, isonome broadcast, pronome bindings, async fan-out; `ContextStore` integration; `pronome.release` audit events
- **0.3 Introspection app** (`src/introspection/`) — dual-mode SSE: streams real `~/.som/events.db` when present, falls back to block-stacking simulation; QueryPanel with 5 query types

## Phase 1 — Complete

- **1.1 Agent base class** (`src/core/agent/`) — deterministic handler or LLM-backed (Haiku default), capability tiers, `agent.cost` signal, `probe()` dry-run, stub mode, per-agent error isolation
- **1.2 Agency container** (`src/core/agency/`) — `Connectable` interface, recursive nesting, `agency.active/dormant`, member error isolation, `highestCapability()` routing
- **1.3 Context store** (`src/core/context/`) — pronomes, frameId, K-line IDs, micronemes; `snapshot()` injected into every emitted signal automatically
- **1.4 Query interface** (`src/core/query/`) — `ACTIVATION_QUERY` (live from event log), `CAUSAL_TRACE` (walks causedBy chain), `REASONING_PROBE` (via `agent.probe()`); `MEMORY_PROBE` wired to real retrieval in Phase 2.2; `CENSOR_CHECK` stub

## Phase 2 — Complete

- **2.1 K-line schema + store** (`src/core/kline/`) — ✅ complete
  - `KLineStore`: SQLite, FTS5/BM25 (Porter stemmer), ULID ordering, read-write vs read-only (B-Brain principle), atomic write with parent→child_ids maintenance
  - `KLine` type with level-bands (core/peripheral/fringe), `AgentActivation`, `KLineGuard`, full situation context

- **2.2 K-line capture + retrieval** (`src/core/kline/`) — ✅ complete
  - `BagOfWordsEmbedder` (64d, deterministic, zero-dependency dev embedder); `OpenAIEmbedder` (1536d, production)
  - `cosineSimilarity`, `temporalDecay`, `effectiveHalfLife`, `hybridScore` (70% vec + 30% FTS), `mmrRerank` (λ=0.7)
  - `capturePositiveKLine()` — walks causedBy chain, classifies agents into bands (core/peripheral/fringe), embeds, writes K-line
  - `createMemoryCaptureAgent()` — deterministic Agent subscribed to `task.succeeded`; emits `kline.captured`
  - `KLineRetrievalEngine.retrieve()` — full hybrid pipeline: embed → cosine sim → BM25 → hybrid score → temporal decay → MMR
  - `KLineRetrievalEngine.retrieveSimilarTo()` — retrieve by existing K-line id

- **2.3 Censor/suppressor capture** (`src/core/kline/censor.ts`) — ✅ complete
  - `captureCensorKLine()` — walks causedBy chain, extracts `blocked_action` from `tool_intent` or payload, builds `precursor_pattern`, embeds, writes censor K-line
  - `createCensorCaptureAgent()` — subscribes to `task.failed`, `agent.error`, `bad_outcome.occurred`
  - `KLineRetrievalEngine.retrieveCensors(situation, action)` — retrieves censor K-lines matching situation + blocked_action (substring match)
  - `CENSOR_CHECK` query now real (not stub) when retrieval engine is provided
  - FTS query sanitizer added to KLineStore (`load-bearing` → `"load" "bearing"` — prevents FTS5 column-filter parse errors)

- **2.4 Memory Probe Query + Memory Feedback Graph** (`src/introspection/`) — ✅ complete
  - `KLineReader.ts` — read-only SQLite K-line reader with inline BagOfWords embedder (64d), FTS sanitizer, hybrid `retrieve()` (70% vec + 30% FTS)
  - `/api/klines` route — returns K-lines + agent activation states for graph
  - `/api/query` route — MEMORY_PROBE and CENSOR_CHECK now wired to real K-line store
  - `QueryPanel.tsx` — MEMORY_PROBE shows scored K-line cards with band pills; CENSOR_CHECK shows ⚠ FIRES / ✓ Clear with matching censors
  - `MemoryFeedbackGraph.tsx` — SVG directed graph: agent circles (left) → K-line hexagons (right); edges colored/weighted by band (core=thick solid, peripheral=medium, fringe=thin dashed); legend; empty-state message

## Phase 3 — In Progress

- **3.1 Frame schema + storage** (`src/core/frame/`) — ✅ complete
  - `Frame` type with named `Terminal` slots (type, default_value, default_confidence, required)
  - `FrameStore`: SQLite, FTS5 (name + description), ULID ordering, WAL mode
  - `write()`, `getById()`, `getByName()`, `upsertByName()`, `list()`, `searchFts()`, `update()`
  - `getWithInheritance(id)` — walks parent_frame_id chain, child terminals shadow parent (prototype inheritance)
  - 22 tests covering CRUD, inheritance chain (3 levels), terminal override, FTS, persistence

- **3.2 Frame matching + slot-filling** (`src/core/frame/`) — ✅ complete
  - `FrameMatcher` — scores frames against a signal: signal-name token overlap (0.5) + payload key overlap (0.3) + pronome role overlap (0.2); `match()` returns all candidates sorted; `best()` returns top above threshold
  - `fillSlots()` — fills every terminal from sources in priority order: payload (1.0) → K-line pronomes (score×0.8) → pronome bindings (0.7) → frame defaults → empty
  - `createFrameAgent()` — deterministic agent subscribing to `["*"]`; skips activation/pronome-bind/frame.selected signals; runs matcher, fills slots, calls `ctx.bus.context.setFrame()`, emits `frame.selected`
  - 21 tests: matcher scoring, priority cascade, K-line slot filling, agent→ContextStore integration, causedBy chain, threshold filtering

- **3.3 Trans-frames + frame-arrays** (`src/core/frame/`) — ✅ complete
  - `TransFrameRoles` — six canonical roles: Actor, Action, Object, Origin, Destination, Instrument
  - `TransFrame` interface (extends Frame with `frame_type: "trans"` and `roles: TransFrameRoles`)
  - `isTransFrame()` type-guard for discriminated union narrowing
  - `FrameType = "standard" | "trans"` stored in DB; `roles` as JSON column
  - `FrameArrayRecord` — named collection of frames sharing terminal vocabulary
  - `FrameStore.writeTransFrame()`, `getTransFrame()`, `writeFrameArray()`, `getFrameArray()`, `getFrameArrayByName()`
  - `FrameStore.switchPerspective(arrayId, toFrameId, currentValues)` — carries shared terminal values to new perspective, drops frame-specific values; case-insensitive matching
  - 21 tests: trans-frame CRUD, type-guard, inheritance, frame-array CRUD, perspective switch (shared/dropped/non-member/case-insensitive)

## Phase 5 — Complete

- **5.2 Conversational agent** (`src/core/conversation/`) — ✅ complete
  - 4 agents: TopicAgent (keyword extraction), RetrievalAgent (K-line retrieval), ResponseAgent (response generation), ConversationMemoryAgent (K-line capture)
  - Signal chain: `conversation.input` → `topic.identified` → `context.retrieved` → `conversation.response` → `kline.captured`
  - Cross-session memory: second turn on same topic retrieves first turn's K-lines; response references them
  - 10 tests: signal chain, causedBy chain, K-line capture, cross-session retrieval, unrelated-topic isolation

- **5.1 Block-builder demo society** (`src/core/demo/`) — ✅ complete
  - 5 deterministic agents: FindAgent (orchestrator), SeeAgent, GraspAgent, MoveAgent, PutAgent
  - Signal chain: `task.start` → `block.found` → `block.described` → `grip.ready` → `block.placed` → `placement.confirmed` → `task.succeeded`
  - FindAgent loops for N blocks; emits `task.succeeded` with explicit vocabulary for K-line retrieval
  - Full integration: K-line capture, censor guard, B-Brain observer, conflict resolver
  - 15 tests: signal chain, causedBy, K-line capture+retrieval, censor.fired, B-Brain clean-run, end-to-end

## Phase 4 — Complete

- **4.4 B-Brain observer agent** (`src/core/bbrain/`) — ✅ complete
  - `createBBrain(opts)` — deterministic agent subscribing to `["*"]`; never emits action signals
  - Loop detection: per-`signal:source` timestamp window; fires `bbrain.loop.detected` on > loopThreshold occurrences; deduped within window; activation-type signals excluded
  - Error burst: sliding window on `agent.error`; fires `bbrain.error.burst` on > errorBurstThreshold
  - Conflict spiral: independent round counter per (terminal, sorted-agent-pair); fires `bbrain.conflict.spiral` on > spiralThreshold
  - Stall: `setInterval` with `.unref()` (doesn't block process exit); fires `bbrain.stall.detected` when `activeGoals > 0` and silence ≥ stallWindow; resets on any signal
  - All emitted signals: source `"b-brain"`, prefix `bbrain.*`; self-signals skipped to prevent feedback loops
  - 18 tests: loop/error-burst/spiral/stall detection, identity guarantees, edge cases

- **4.3 Censor/suppressor guards** (`src/core/censor/`) — ✅ complete
  - `createCensorRegistry(retrieval, opts)` — deterministic agent subscribing to all `tool_intent` signals
  - On each tool intent: builds situation description (`action + signal + frame + pronomes`), calls `retrieveCensors()`
  - Emits `censor.fired` (type `"censor"`) with `action`, `kline_id`, `precursor_pattern`, `score` when match ≥ minScore
  - Underscore-to-token conversion for tool names ("move_block" → "move block") ensures bag-of-words overlap with stored censors
  - Non-fatal retrieval errors silently swallowed — guard agents must never crash the bus
  - 8 tests: known-bad action fires, payload shape, causedBy chain, type=censor, unrelated action silent, minScore threshold, polyneme type ignored, multiple intents

- **4.2 Cross-exclusion + noncompromise** (`src/core/conflict/`) — ✅ complete
  - `ConflictPayload` — `{ agent_id, competing_agent_id, terminal, priority, competing_priority }`
  - `createConflictResolver(opts)` — deterministic agent subscribing to `agent.conflict`
  - Cross-exclusion: higher priority wins; ties broken alphabetically; emits `agent.suppressed` for loser
  - Round tracking: conflict key = `"${terminal}:${sortedAgentA}:${sortedAgentB}"`
  - Noncompromise: at threshold (default 3), suppress both + emit `conflict.noncompromise`; reset count
  - 12 tests: priority resolution, tie-breaking consistency, independent terminal tracking, noncompromise path, count reset, causedBy chain

- **4.1 Difference-engine** (`src/core/goal/`) — ✅ complete
  - `Goal` type: id, description, frame_id, desired (terminal_name → required value), active
  - `GoalStore`: SQLite, WAL mode, `write()`, `getById()`, `listActive()`, `setActive()`
  - `detectGaps(desired, current)` — strict equality comparison, returns `GoalGap[]`
  - `createGoalAgent(goalStore)` — deterministic agent, in-memory goal + state tracking
  - `setGoal(bus, goalStore, input)` — writes to store + emits `goal.set` on bus
  - Signal flow: `goal.set` → gap detection → `goal.gap` × N; `state.updated` / `gap.closed` → re-detect; `goal.achieved` when all gaps closed
  - Multiple concurrent goals tracked independently; `setActive(false)` on achievement
  - 20 tests: detectGaps unit tests, GoalStore CRUD, agent integration (causedBy chain, incremental gap closing, multi-goal independence)

## Test suite

```bash
cd src/core && npm test
# 238 tests across 39 suites — all pass
```

## Running the introspection app

```bash
cd src/introspection && npm run dev   # http://localhost:3000
```

## Theming the introspection app

All colors are defined in two files — edit these to retheme the entire UI:

| File | What it controls |
|------|-----------------|
| `src/introspection/app/globals.css` | Everything rendered by CSS: backgrounds, text, borders, buttons, inputs, agent state cards, K-line cards, band pills, signal colors. Edit the `:root { … }` block at the top. |
| `src/introspection/app/theme.ts` | Colors used inside `<svg>` elements (the Memory Feedback Graph): K-line fill/stroke, band edge colors/widths, agent node colors. Mirror any palette change here too. |

Components (`SocietyView.tsx`, `QueryPanel.tsx`, `MemoryFeedbackGraph.tsx`) use semantic class names (`som-*`) and never hard-code colors directly.

## Emitting test events to the real log

```bash
cd src/core && npm run emit-test      # writes to ~/.som/events.db
```

## Operating Modes

The system has two modes, enforced via a PreToolUse hook in every agent container:
- **OBSERVE mode** (default): Agents reason and accumulate K-lines; tool calls are intercepted and logged as intents, not executed. Memory builds. Nothing acts on the world.
- **ACT mode**: Tool calls execute, subject to action tier (auto_allow / requires_approval / deny) from `~/.som/policy/tool-tiers.json`.

Start everything in OBSERVE mode. Use the Query Interface to validate that memory is working before enabling ACT mode.

## Key Files for Resuming

- `docs/ARCHITECTURE.md` — The full system design (living copy). Sections 3.1-3.7 describe the components to build.
- `docs/FEASIBILITY.md` — Critical analysis. Section 8 has recommendations on build order (start with K-line memory, instrument everything).
- `docs/KLINE_MEMORY.md` — K-line memory subarchitecture: full data model, capture/retrieval/consolidation workflows, SQLite schema, and build order. Based on patterns from openclaw's memory implementation.
- `docs/OBSERVE_AND_CONTROL.md` — OBSERVE/ACT modes, query interface, action tiers, approval flow, and revised Phase 0 build order. Based on nanoclaw's PreToolUse hook and allowlist patterns.
- `docs/VERSIONING.md` — How documentation is versioned. V1_0 is frozen.
- `reference/society_of_mind.md` — Full book text if you need to look up a Minsky concept.

## GitHub

Public repo: github.com/lewtucker/society-of-mind-agents (development has been discontinued)
