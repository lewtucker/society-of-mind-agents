---
title: Implementation Summary
version: 1.0
date: 2026-04-03
author: Lew Tucker
status: living
---

# Implementation Summary — Society of Mind Agentic System

A Minsky-inspired agentic system with long-term memory, goal-driven reasoning, failure
learning, and conflict resolution. Built in TypeScript/Node.js as a purely ESM package
with SQLite for all persistent state.

---

## Line Count Totals

| Category                  | Lines  |
|---------------------------|-------:|
| Core source code          |  5,682 |
| Core test code            |  5,670 |
| Introspection app         |  2,002 |
| Documentation             |  2,607 |
| **Grand total**           | **15,961** |

Tests are written at near-parity with source (5,670 vs 5,682) — every component is
covered by integration tests against real SQLite databases and a real polyneme bus.
No mocking.

---

## Source Code by Phase

### Phase 0 — Foundation Infrastructure  (551 lines source / 311 lines test)

| Module | Files | Source | Test |
|--------|-------|-------:|-----:|
| Event log (`event-log/`) | EventLog.ts, schema.ts, types.ts, index.ts | 302 | 141 |
| Polyneme bus (`polyneme-bus/`) | PolynemeBus.ts, types.ts, index.ts | 249 | 170 |

**Key decisions:**
- SQLite with WAL mode and monotonicFactory ULID ordering for the event log
- Async fan-out via `queueMicrotask` on the bus (subscribers never block each other)
- `pronome.release` audit events for role binding lifecycle
- `getActivationStates()` derived from event log (no separate state store)

---

### Phase 1 — Agent Infrastructure  (898 lines source / 977 lines test)

| Module | Files | Source | Test |
|--------|-------|-------:|-----:|
| Agent base class (`agent/`) | Agent.ts, types.ts, index.ts | 394 | 300 |
| Agency container (`agency/`) | Agency.ts, types.ts, index.ts | 152 | 257 |
| Context store (`context/`) | ContextStore.ts, index.ts | 100 | 217 |
| Query interface (`query/`) | QueryEngine.ts, types.ts, index.ts | 252 | 203 |

**Key decisions:**
- Four capability tiers: `deterministic` → `haiku` → `sonnet` → `opus`; LLM agents
  emit `agent.cost` signals for token accounting
- `probe()` dry-run mode — agents report what they would emit without side effects
- Stub mode: LLM-backed agents degrade gracefully to no-ops when no API key is set
- `ContextStore.snapshot()` auto-injected into every emitted signal (pronomes, frameId,
  K-line IDs, micronemes)
- `Agency.highestCapability()` routing — agency exposes its most powerful member's tier

---

### Phase 2 — K-Line Memory  (1,653 lines source / 949 lines test)

| Module | Files | Source | Test |
|--------|-------|-------:|-----:|
| K-line store (`kline/`) | KLineStore.ts, schema.ts, types.ts | 607 | 272 |
| Capture + retrieval | capture.ts, retrieval.ts, similarity.ts, embedding.ts | 713 | 321 |
| Censor capture | censor.ts | 319 | 356 |
| Index | index.ts | 14 | — |

**Key decisions:**
- FTS5/BM25 (Porter stemmer) + 64-dimensional BagOfWords vectors (DJB2 hash, zero
  dependencies) for dev; `OpenAIEmbedder` (1536d) for production
- Hybrid scoring: 70% cosine similarity + 30% BM25; temporal decay by level-band
  half-life; MMR re-ranking (λ=0.7) for diversity
- `capturePositiveKLine()` walks the causedBy chain to classify agents into
  core / peripheral / fringe bands; uses `payload.description` when present for
  predictable retrieval vocabulary
- Censor K-lines store `blocked_action` + `precursor_pattern`; `retrieveCensors()`
  matches on situation + action substring; FTS sanitizer converts hyphenated tokens
  to quoted phrases to avoid FTS5 column-filter parse errors
- Read-only / read-write boundary: only capture agents hold write access to KLineStore

---

### Phase 3 — Frame System  (1,074 lines source / 1,107 lines test)

| Module | Files | Source | Test |
|--------|-------|-------:|-----:|
| Frame store (`frame/`) | FrameStore.ts, schema.ts, types.ts, index.ts | 676 | 339 |
| Frame matching + slot-filling | matcher.ts, slotfiller.ts, FrameAgent.ts | 388 | 768 |

**Key decisions:**
- `getWithInheritance()` walks `parent_frame_id` chain; child terminals shadow parent
  (prototype inheritance — a direct implementation of Minsky §24)
- `FrameMatcher` scores frames against a signal: signal-token overlap (0.5) +
  payload-key overlap (0.3) + pronome role overlap (0.2)
- `fillSlots()` priority cascade: payload (1.0) → K-line pronomes (score×0.8) →
  pronome bindings (0.7) → frame defaults → empty
- `TransFrame` with six canonical roles (Actor/Action/Object/Origin/Destination/
  Instrument) stored as a discriminated union via `FrameType` column in SQLite
- `switchPerspective()` preserves shared terminal values across frame-array members;
  drops frame-specific terminals; case-insensitive key matching

---

### Phase 4 — Goals and Control  (1,019 lines source / 1,504 lines test)

| Module | Files | Source | Test |
|--------|-------|-------:|-----:|
| Difference-engine (`goal/`) | engine.ts, GoalStore.ts, types.ts, schema.ts, index.ts | 439 | 414 |
| Cross-exclusion (`conflict/`) | resolver.ts, types.ts, index.ts | 196 | 317 |
| Censor registry (`censor/`) | registry.ts, index.ts | 145 | 295 |
| B-Brain observer (`bbrain/`) | BBrain.ts, index.ts | 239 | 478 |

**Key decisions:**
- `detectGaps()` strict equality — no fuzzy matching on goal terminal values
- `createGoalAgent()` uses in-memory maps for active goals + current state; reactive
  loop: `goal.set` → `goal.gap` × N; `state.updated` / `gap.closed` → re-detect;
  `goal.achieved` when all gaps close; multiple concurrent goals tracked independently
- Cross-exclusion winner: higher priority; alphabetical tie-break for consistency;
  noncompromise (Minsky §26) at threshold (default 3) suppresses both sides and
  resets the round counter
- CensorRegistry converts tool names from underscore to spaces before building the
  situation description ("move_block" → "move block") to ensure token overlap with
  stored censor K-lines in the BagOfWords embedder
- B-Brain `.unref()` on its stall-detection `setInterval` to prevent Node.js from
  holding the event loop open during tests; sources all emits as `"b-brain"` and
  skips `bbrain.*` signals to prevent self-feedback loops

---

### Phase 5 — Demo Societies  (436 lines source / 822 lines test)

| Module | Files | Source | Test |
|--------|-------|-------:|-----:|
| Block-builder demo (`demo/`) | agents.ts, index.ts | 173 | 537 |
| Conversational agent (`conversation/`) | agents.ts, types.ts, index.ts | 263 | 285 |

**Key decisions:**
- `FindAgent` emits `task.succeeded` with an explicit `description` field
  ("block tower build grasp place stack … succeeded") so `capturePositiveKLine()`
  embeds predictable vocabulary for retrieval across runs
- `RetrievalAgent` is async (retrieval pipeline is `async`) and emits via
  `ctx.bus.emit()` from inside a `.then()`; returns `{ emit: [] }` synchronously so
  the bus never stalls waiting for retrieval
- `ResponseAgent` embeds `description: "conversation {topic} {keywords} query response"`
  in its payload — the same vocabulary it will search for in the next turn
- Censor pre-seed: `blocked_action: "grasp_block"` with description including
  "block tower grasp already placed reuse collision failure" — validates that
  underscore→space tokenisation produces the required BagOfWords overlap

---

### Infrastructure Script  (51 lines)

| File | Lines |
|------|------:|
| `scripts/emit-test.ts` | 51 |

Seeds `~/.som/events.db` with a realistic block-stacking run for the introspection app.

---

## Introspection App  (2,002 lines)

Next.js 16 real-time viewer. Runs in two modes: streams live events from `~/.som/events.db`
when present; falls back to a built-in block-stacking simulation.

| File | Lines | Purpose |
|------|------:|---------|
| `api/events/route.ts` | 201 | SSE endpoint — tails event log or simulation |
| `api/query/route.ts` | 125 | QueryPanel queries (5 types) |
| `api/klines/route.ts` | 32 | K-line cards + graph data |
| `components/SocietyView.tsx` | 247 | Signal stream + agent activation table |
| `components/QueryPanel.tsx` | 398 | Five query modes, K-line cards with band pills |
| `components/MemoryFeedbackGraph.tsx` | 331 | SVG graph: agent circles → K-line hexagons, band-weighted edges |
| `lib/EventLogReader.ts` | 125 | Read-only SQLite reader for events |
| `lib/KLineReader.ts` | 236 | Read-only K-line reader with inline embedder |
| `lib/scenario.ts` | 233 | Block-stacking simulation (no DB required) |
| `app/layout.tsx` + `page.tsx` + `types.ts` | 74 | Next.js shell |

---

## Documentation  (2,607 lines)

| Document | Lines | Purpose |
|----------|------:|---------|
| `Implementation_Plan.md` | 610 | Master build-order guide: phase specs, acceptance criteria, dependency graph |
| `KLINE_MEMORY.md` | 500 | K-line subarchitecture: SQLite schema, capture/retrieval/consolidation, level-banding, censor workflow |
| `ARCHITECTURE.md` | 479 | Full system design: Minsky concept→implementation mapping, signal taxonomy, component interfaces |
| `OBSERVE_AND_CONTROL.md` | 353 | OBSERVE/ACT modes, query interface, action tiers, approval flow |
| `FEASIBILITY.md` | 346 | Critical analysis: risks, mitigations, build-order rationale, open questions |
| `Scenario-1-Block_Stacking.md` | 223 | Block-stacking scenario walkthrough: signal-by-signal trace |
| `VERSIONING.md` | 96 | Documentation versioning conventions (YAML frontmatter, V{x}_{y} frozen folders) |

---

## Test Suite Summary

| Suite | Tests | Lines |
|-------|------:|------:|
| EventLog | 7 | 141 |
| PolynemeBus | 9 | 170 |
| Agent | 8 | 300 |
| Agency | 8 | 257 |
| ContextStore | 9 | 217 |
| QueryEngine | 9 | 203 |
| KLineStore | 14 | 272 |
| KLineCapture | 16 | 321 |
| KLineCensor | 18 | 356 |
| FrameStore | 22 | 339 |
| FrameMatching | 21 | 453 |
| TransFrame | 21 | 315 |
| Goal | 20 | 414 |
| Conflict | 12 | 317 |
| CensorRegistry | 8 | 295 |
| BBrain | 18 | 478 |
| BlockBuilder (demo) | 15 | 537 |
| Conversation | 10 | 285 |
| **Total** | **238** | **5,670** |

All 238 tests pass. No mocking — every test uses a real `PolynemeBus` backed by a real
`EventLog` in a temp directory, with real SQLite databases for K-lines, frames, and goals.

---

## Minsky Concepts Implemented

| Concept | Minsky Chapter | Implementation |
|---------|---------------|----------------|
| Agent / Agency | §1–2 | `Agent` base class + `Agency` container |
| Polyneme | §19 | `PolynemeBus` — same signal, different meaning per subscriber |
| Pronome | §21 | `ContextStore` role bindings auto-injected into every signal |
| K-Line | §8 | `KLineStore` + `capturePositiveKLine()` + retrieval pipeline |
| Level-Band | §16 | core / peripheral / fringe classification in `classifyAgents()` |
| Frame | §24 | `FrameStore` with prototype inheritance via `parent_frame_id` |
| Trans-frame | §21 | `TransFrame` with six canonical roles |
| Frame-array | §24 | `FrameArrayRecord` + `switchPerspective()` |
| Difference-engine | §7 | `createGoalAgent()` — desired vs. current state loop |
| Cross-exclusion | §16 | `createConflictResolver()` — mutual inhibition by priority |
| Noncompromise | §26 | Threshold-based suppression of both sides in conflict |
| Censor / Suppressor | §27 | `createCensorRegistry()` + `captureCensorKLine()` |
| B-Brain | §6 | `createBBrain()` — supervisory observer, never acts |
