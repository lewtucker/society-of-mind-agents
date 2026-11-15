---
title: Project Summary — Society of Mind Agentic System
version: 1.0
date: 2026-04-03
author: Lew Tucker
status: living
---

# Project Summary — Society of Mind Agentic System

## What We Built

A working implementation of Marvin Minsky's *Society of Mind* (1986) as a software system,
designed to use Large Language Models as the reasoning substrate for each agent.

> **Note (2026-11-14):** Several statements in this summary describe aspirational goals of
> the design rather than demonstrated results. In particular, every agent in the built
> system runs as deterministic code; no LLM-backed agent was ever run, and retrieved
> K-lines are never used to re-activate agents. These goals are marked below. See
> [PROJECT_POSTSCRIPT.md](PROJECT_POSTSCRIPT.md) for what was and was not demonstrated.

The system consists of specialized agents that communicate through a typed event bus,
accumulate long-term memory via K-lines, learn from failure through censors and
suppressors, represent knowledge in frames with prototype inheritance, resolve conflicts
through cross-exclusion and noncompromise, and are supervised by a B-Brain layer that
watches for anomalies without participating in the work.

Two demo societies are included: a block-stacking assembly society (Minsky's original
example) and a conversational society that retrieves relevant past exchanges to inform
its responses. Both demonstrate that memory is captured in one session and retrieved in
the next. Showing that this memory *improves behavior* across sessions — something no
individual LLM call can do alone — was an aspirational goal that was not tested.

---

## Why We Built It

### The 1986 Problem

Minsky published *The Society of Mind* in 1986 as a theory of how human minds work.
The book describes intelligence as emerging from the *interaction* of many specialized
agents — each capable of reasoning within its domain, but ignorant of the larger picture.
No single agent contains the intelligence of the whole. The society does.

The theory was visionary and architecturally precise. But Minsky had to describe agents
abstractly because no technology existed to implement them. The "mindless" agents he
described were conceptual placeholders, not executable components.

### The 2026 Opportunity

In 2026, LLMs are exactly the agents Minsky needed. An LLM-backed agent can reason about
its domain, handle ambiguity, make judgments, and respond to novel situations — but it
cannot maintain long-term memory, learn from failure across sessions, or coordinate with
competing perspectives. It needs a society.

The key insight is that *LLMs are not replacements for the Society of Mind architecture —
they are its natural substrate*. The society provides what individual LLMs lack:
persistence, structured memory, failure learning, conflict resolution, and an audit trail
that makes behavior explicable. The LLM provides the thinking; the society provides the
remembering, coordinating, and growing.

### What Made This the Right Moment

Three independent developments converged:

1. **LLMs as reasoning agents**: Models like Claude, GPT-4, and Gemini can reason within
   a narrow domain when given the right system prompt and context. This is precisely what
   Minsky's agents do.

2. **SQLite as ubiquitous structured storage**: Lightweight, zero-configuration, and
   embedded — ideal for the K-line store, frame store, goal store, and event log.
   The entire system runs locally with no external services required.

3. **Vector similarity as memory retrieval**: BM25 and cosine similarity over embeddings
   solve the K-line retrieval problem (find me a past situation similar to this one) in a
   way that is both fast and theoretically grounded in Minsky's level-banding model.

---

## Key Design Decisions

### 1. No Central Controller

The most important architectural choice. There is no orchestrator, no master agent, no
routing layer that decides which agent to call next. Intelligence emerges from agents
reacting to signals they subscribe to.

This is not a performance optimization. It is the core theoretical claim: a system with
a central controller is not a Society of Mind. It is a pipeline with extra steps. The
society's behavior is qualitatively different because agents with different agendas —
different frames, different K-lines, different priorities — interact, conflict, and resolve.
That interaction is where intelligence lives.

**Consequence**: Debugging looks different. You don't trace a call stack. You trace a
causal chain through the event log.

### 2. K-Lines as Activation Snapshots, Not Data

A K-line is not a memory of *what happened*. It is a memory of *which agents were
active* during a successful episode, along with the context that made them active. The
design goal was that, when retrieved, a K-line would not replay a sequence — it would
re-activate the *same configuration of agents* that solved the problem before. (This
re-activation step is aspirational: capture and retrieval were built, but nothing yet
wakes the agents a retrieved K-line names.)

This is why K-lines are meant to improve behavior rather than just recall facts. Reactivating a
K-line puts the system in a similar mental state to when the problem was previously solved:
the same agents are available, the same defaults are pre-loaded, the same frames are
primed. The system becomes "more like an earlier version of itself."

**Implementation**: `capturePositiveKLine()` walks the `causedBy` chain from a
`task.succeeded` event, identifies every contributing agent, classifies them into
core/peripheral/fringe bands by causal proximity, and embeds the situation description.
Retrieval is a hybrid BM25 + cosine similarity pipeline with temporal decay and MMR
re-ranking.

### 3. Level-Banding: Confidence Gradients, Not Flat Facts

K-line fields are stored at three confidence levels. Core fields (agents on the critical
causal path) persist indefinitely. Peripheral fields (contributors that could have been
replaced) decay over months. Fringe fields (context that happened to be present) decay
over weeks.

This mirrors how human memory works: we remember the central action clearly, the
supporting context roughly, and the ambient details barely. It also prevents the knowledge
store from filling up with high-confidence trivia.

**Consequence**: Retrieval scores blend cosine similarity, BM25 rank, and temporal decay,
weighted by the dominant band of the K-line. A strong recent core-band K-line scores
higher than a weak old fringe-band K-line for the same situation.

### 4. The Polyneme Bus as Heterogeneous Communication

The same signal means different things to different subscribers. A `block.found` event
triggers Grasp to plan its grip approach while simultaneously triggering Move to plan a
path — from the same signal, without any coordination. Neither agent knows the other
received the same signal.

This is not just pub/sub. It is a deliberate commitment to heterogeneous communication:
agents are not supposed to share a common language. They share signals, and each agent
has learned its own response to each signal it cares about. The bus does not impose
structure on what agents do with a signal.

**Consequence**: Adding a new agent that subscribes to an existing signal costs nothing to
the agents that already subscribe to that signal. The society grows without requiring
existing agents to change.

### 5. Failure Learning via Censors and Suppressors

Positive K-lines record what worked. Censor K-lines record what *must not be attempted*
given a recognizable precursor pattern. When the censor registry detects a `tool_intent`
signal matching a stored censor's situation + blocked action, it emits `censor.fired`
*before the action is taken* — preventing the failure from recurring.

**The critical distinction**: A suppressor fires *after* a bad outcome and blocks the
same action next time. A censor fires *before* the action, by recognizing the
precursor state that historically led to the bad outcome. Censors are learned prediction;
suppressors are learned avoidance. Both accumulate over time.

**Consequence**: The system gets harder to fail in the same way twice. A censor installed
after a tower collapse due to block reuse will prevent the same error on every subsequent
run, without the orchestrating agents knowing why the candidate block was rejected.

### 6. The B-Brain: Observation Without Contamination

The B-Brain is a supervisory agent layer that observes all signals and detects anomalies
(loops, error bursts, conflict spirals, stalls) but *never emits action signals into the
working bus*. Its outputs are diagnostic only.

This design choice is critical. If the B-Brain could intervene in the working society, it
would become a central controller by another name. Instead it watches, reports, and alerts
— but the A-Brain agents must handle any intervention themselves, through the same
mechanisms (signals, conflict resolution, goal adjustment) that govern all behavior.

**Consequence**: The B-Brain's `.unref()` timer (for stall detection) is the most
technically subtle choice in the system. It must poll for stalls without preventing the
Node.js process from exiting when the work is done. This is a direct expression of the
B-Brain's non-participant role.

### 7. Frames with Prototype Inheritance

Frames represent knowledge templates with named slots (terminals). A frame can have a
parent frame, and child terminals shadow parent terminals — exactly like prototypal
inheritance in JavaScript, but stored in SQLite with explicit `parent_frame_id` links.

`fillSlots()` populates terminals from a priority cascade: signal payload (highest
confidence) → K-line pronomes → pronome bindings → frame defaults → empty. This means
that specific, current information always displaces general defaults, while defaults
ensure the system never has an empty frame.

**Consequence**: New scenarios can reuse the frame hierarchy. A `TowerBuild` frame that
inherits from `AssemblyTask` inherits all the assembly defaults while overriding only the
tower-specific terminals.

### 8. OBSERVE/ACT Mode Separation

All agents run in OBSERVE mode by default. In OBSERVE mode, `tool_intent` signals are
emitted and logged but not executed — tool calls are intercepted as intents. Memory
accumulates. The system learns. Nothing acts on the world.

ACT mode enables tool execution subject to action tiers: `auto_allow` (proceeds
automatically), `requires_approval` (waits for human confirmation), and `deny`
(permanently blocked regardless of agent intent). The censor registry runs in both modes,
but only ACT mode has real-world consequences.

**Consequence**: You can run the entire society for hours, accumulate K-lines, observe
behavior, and tune censors — all with zero risk of unintended external actions. The
transition to ACT mode is deliberate and reversible.

---

## What the System Demonstrates

### Behavior That Exceeds Individual Agents

No single agent in the block-builder society knows how to build a tower. FindAgent knows
how to find a block. SeeAgent knows how to describe one. GraspAgent knows how to grip.
MoveAgent knows how to move. PutAgent knows how to place. None of them knows what a tower
is, what the goal is, or what the other agents are doing.

The tower gets built because the agents' individual responses to signals compose into a
coherent sequence. The intelligence is in the composition, not in any agent.

### Memory That Improves Behavior Across Sessions

In the block-builder, the second run retrieves the K-lines captured by the first. The
conversational society's second turn on a familiar topic retrieves K-lines from the first
turn and references them in its response. This is not a cache or a session variable — it
is a hybrid similarity search over a growing vector store.

The aspirational goal — that the second run *behaves* measurably better than the first —
was not tested. Retrieval works; using retrieved memory to change what the society does
was not built.

### Failure Learning That Persists

The censor pre-installed in the block-builder demo represents a learned failure: a prior
run where a block already in the tower was selected as a candidate, causing structural
collapse. That failure is now encoded as a K-line that fires *before* the mistake recurs.
The censor was installed by hand; the full loop of failing, capturing a censor from the
failure and avoiding it next time remains an aspirational goal that was not run end to end.

### Observable Causal Chains

Every signal is logged with a `causedBy` pointer. The full causal chain from
`task.succeeded` back to `task.start` is reconstructable at any time via the
introspection app's CAUSAL_TRACE query. This is not an afterthought — it is what
makes the system auditable and trustworthy.

---

## What This Is Not

**It is not a chatbot wrapper.** LangChain and similar frameworks chain LLM calls in
sequence with a routing layer deciding what to call next. This system has no routing layer.
Agents activate by subscribing to signals, not by being called.

**It is not a multi-agent debate system.** Systems like AutoGen and CrewAI have agents
arguing with each other over a shared message thread. This system has agents reacting to
typed signals through a bus, accumulating K-lines, and resolving conflicts through
structured mechanisms rather than conversational turns.

**It is not a retrieval-augmented generation system.** RAG systems retrieve documents
to improve a single LLM call. This system is designed to retrieve K-line activation
states to put the *entire society* in a similar mental state to when a previous success
occurred.

The difference is architectural depth: RAG adds a retrieval step before generation;
this system aims to use retrieval to configure the entire agent activation pattern. (This
is an aspirational goal; see the note at the top.)

---

## References

### Primary Source

- Minsky, M. (1986). *The Society of Mind*. Simon & Schuster. ISBN 978-0-671-65713-0.
  The founding theoretical work. Every component of this implementation maps to a
  specific chapter or concept. Chapters referenced most heavily: §1–2 (Agents/Agencies),
  §6 (B-Brain), §7–8 (Difference-engine, K-Lines), §16 (Level-bands, Cross-exclusion),
  §19 (Polynemes, Isonomes), §21 (Pronomes, Trans-frames), §24 (Frame-arrays),
  §26 (Noncompromise), §27 (Censors/Suppressors).

### Related Work

- Minsky, M. (1975). "A Framework for Representing Knowledge." In *The Psychology of
  Computer Vision* (ed. Winston, P.H.). McGraw-Hill. The original frames paper, which
  the `FrameStore` with terminal slots and prototype inheritance directly implements.

- Schank, R.C. & Abelson, R.P. (1977). *Scripts, Plans, Goals and Understanding*.
  Erlbaum. The neighboring theory that influenced Minsky's frame work; scripts are
  sequential frame-arrays. Relevant to multi-step task planning.

- Anderson, J.R. (1983). *The Architecture of Cognition*. Harvard University Press.
  ACT* production system — an alternative cognitive architecture that reached similar
  conclusions about the importance of procedural vs. declarative memory. K-lines
  approximate ACT*'s procedural memory.

- Tulving, E. (1985). "Memory and Consciousness." *Canadian Psychology*, 26(1), 1–12.
  Episodic vs. semantic memory distinction. K-lines capture episodic activations;
  retrieval generalizes toward semantic (pattern-level) knowledge over time.

- Brown, T.B. et al. (2020). "Language Models are Few-Shot Learners." *NeurIPS 2020*.
  The GPT-3 paper establishing that LLMs can function as domain reasoners with minimal
  context — the empirical foundation for using them as Minsky's agents.

- Lewis, P. et al. (2020). "Retrieval-Augmented Generation for Knowledge-Intensive NLP
  Tasks." *NeurIPS 2020*. The RAG paper. K-line retrieval is architecturally adjacent but
  retrieves agent activation states rather than text passages.

- Park, J.S. et al. (2023). "Generative Agents: Interactive Simulacra of Human Behavior."
  *UIST 2023*. The most related published work: LLM-backed agents with memory streams.
  Key difference — this project uses Minsky's theoretical framework for memory
  structure (K-lines, level-bands, censors) rather than natural-language memory summaries.

- Wooldridge, M. & Jennings, N.R. (1995). "Intelligent Agents: Theory and Practice."
  *The Knowledge Engineering Review*, 10(2), 115–152. Canonical survey of multi-agent
  systems pre-LLM. The architecture here returns to this tradition with LLMs as the
  agent reasoning component.

### Implementation Influences

- SQLite FTS5 documentation: the BM25 ranking, Porter stemmer, and column-filter syntax
  are all part of the FTS5 module used for K-line full-text retrieval.

- The causedBy chain and ULID monotonic ordering follow patterns from event-sourced
  architectures (Fowler, M. "Event Sourcing." martinfowler.com, 2005). The event log
  is an append-only, causally linked record — not a mutable state store.

---

## Project Repository

Source code: `github.com/lewtucker/society-of-mind-agents`

```
src/core/         — @som/core package (Node.js, TypeScript, ESM)
src/introspection/ — Next.js 16 real-time introspection app
docs/             — Architecture, feasibility, implementation plan, scenario walkthroughs
reference/        — Full text of The Society of Mind
```

238 tests pass across 39 suites. 15,961 lines total.
