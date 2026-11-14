---
title: Society of Mind — Agentic System Architecture
version: "1.0"
date: 2026-03-24
author: Lew Tucker
status: Draft
document-id: SOM-ARCH
changelog:
  - version: "1.0"
    date: 2026-03-24
    summary: Initial architecture. Defines agent/agency model, K-line memory, frames, polyneme bus, introspection app, and 5-phase implementation plan.
---

# Society of Mind — Agentic System Architecture

An agentic system with long-term memory based on Marvin Minsky's *Society of Mind* (1986).

---

## 1. Vision

Minsky's theory proposes that intelligence emerges not from any single process but from the interaction of many specialized agents organized into societies. No single agent contains the intelligence of the whole — each is a specialist, capable of reasoning within its domain but ignorant of the larger picture. The intelligence lives in the interactions, the memory, and the coordination.

In 1986, Minsky had to describe agents abstractly because no technology could implement them. In 2026, LLMs are the natural substrate. An LLM-backed agent can reason about its domain, handle ambiguity, and make judgments — but it cannot maintain long-term memory, learn from failure, coordinate across sessions, or resolve conflicts with competing perspectives. The society provides what individual agents lack.

The system should demonstrate:
- Behavior that exceeds what any individual agent achieves alone — and that improves over time
- Long-term memory via K-lines (snapshots of successful agent activations) that persists across sessions
- Frame-based knowledge representation with defaults and slot-filling
- Layered supervision (B-brains) without central control
- Learning from both success and failure, accumulated over weeks and months of use

---

## 2. Minsky Concepts → Software Mapping

### 2.1 Agents and Agencies

| Minsky Concept | Definition | Software Implementation |
|---|---|---|
| **Agent** | Specialized reasoner — capable within its domain, ignorant of the larger picture | LLM-backed service with a focused system prompt, constrained tools, and single responsibility |
| **Agency** | Group of agents viewed as a unified capability | Module/namespace grouping related agents, presenting a coherent interface |
| **Society** | The entire collection of agents, their connections, and shared memory | The complete running system |

**Key principle**: No single agent contains the intelligence of the whole society. Each agent can reason within its specialty — understanding context, making judgments, handling ambiguity — but it doesn't know what other agents are doing, can't maintain memory across sessions, and can't resolve conflicts with competing perspectives. The society provides the coordination, memory, and structure that individual agents lack. Intelligence arises from how agents are *connected and coordinated*, not from what any single agent can do alone.

**Agent vs. Agency duality**: From the outside, an agency appears to "know" something. From the inside, it's a group of specialized reasoners passing signals to each other. Both views are valid and useful at different times.

**What makes this different from bare LLM orchestration**: Current agent frameworks (LangChain, CrewAI, etc.) chain LLM calls in sequence. This architecture adds persistent K-line memory, failure learning via censors, structured conflict resolution, frame-based knowledge, and an observable event bus — the connective tissue that transforms isolated reasoning moments into cumulative, persistent intelligence.

### 2.2 Communication: Polynemes and Isonomes

| Minsky Concept | Definition | Software Implementation |
|---|---|---|
| **Polyneme** | Single signal interpreted differently by each receiving agency | Event broadcast (pub/sub) — each subscriber reacts in its own way |
| **Isonome** | Signal with *uniform* built-in effects across agencies | System-wide control signal (e.g., "increase detail level") |
| **Pronome** | Temporary role binding — "the current Actor" or "the current Goal" | Context variable bound per task/conversation |
| **Microneme** | Subtle context fragment that shades all interpretation | Contextual embedding attached to every message |

**Key principle**: Agents don't share a common language. Communication happens through polyneme broadcasts where each receiver has learned its own response. This means the same event can trigger completely different actions in different agencies — and that's by design.

### 2.3 Memory: K-Lines

| Minsky Concept | Definition | Software Implementation |
|---|---|---|
| **K-Line** | Memory snapshot — records which agents were active during a successful episode | Serialized activation state stored with vector embedding + metadata |
| **Level-Band** | Strong core knowledge + weak peripheral defaults | Confidence-weighted fields; core fields persist, fringe fields decay |
| **Default Assumption** | Weak belief used when no better info available, easily displaced | Low-confidence slot filler in a frame |
| **K-Society** | Collection of K-lines that together represent learned knowledge | A namespace of related memories in the vector store |
| **Knowledge-Tree** | K-lines referencing other K-lines hierarchically | Tree-structured memory index |

**Key principle (K-line theory)**: When you solve a problem, create a K-line that records which agents were active. Later, when a similar problem arises, reactivating that K-line puts the system in a similar mental state — making the same agents available. You become "more like an earlier version of yourself."

**Level-banding is critical**: K-lines don't attach to all agents equally. There's a strong central band (core properties) and weak fringes (peripheral details). The fringes serve as default assumptions — they're easily displaced when better information arrives. Too much detail and the memory is too specific; too little and it's useless.

**Hierarchical memory**: K-lines can reference other K-lines (not just raw agents). This creates knowledge-trees that are more economical and organized, though they lose some perceptual precision in favor of stereotypes and defaults.

### 2.4 Knowledge: Frames

| Minsky Concept | Definition | Software Implementation |
|---|---|---|
| **Frame** | Stereotype knowledge structure with terminal slots and default fillers | Schema/template with typed slots and default values |
| **Terminal** | Slot in a frame where specific information attaches | Typed field in a schema |
| **Trans-Frame** | Action template: Actor → Action → Recipient, with Origin and Destination | Workflow step template with role slots |
| **Frame-Array** | Family of frames sharing terminals but representing different perspectives | Multiple views of the same entity sharing a common interface |
| **Picture-Frame** | Spatial frame indexed by direction-nemes (top, left, center, etc.) | Spatial data structure with directional indexing |

**Key principle**: Frames are pre-formed structures drawn from experience. They contain many default assumptions about typical situations. Most knowledge is represented through frame defaults, not explicit facts. When you encounter a new situation, you retrieve the closest matching frame and let its defaults fill in whatever you don't yet know — then override defaults as specifics arrive.

### 2.5 Goals: Difference-Engines

| Minsky Concept | Definition | Software Implementation |
|---|---|---|
| **Difference-Engine** | Compare current state to desired state; activate agents to reduce the gap | Goal-driven planning loop |
| **Suppressor** | Reacts *after* an undesired state occurs — blocks the action | Post-validation guard |
| **Censor** | Intercepts *before* an undesired state — deflects the thought | Pre-validation guard / circuit breaker |
| **Demon** | Lurks silently watching for a specific condition, then intervenes | Event listener / trigger |

**Key principle**: A goal = a representation of a desired state + a mechanism to persist until that state is achieved. Difference-engines create the appearance of "purpose" and "intention" without requiring any agent to consciously want anything.

**Learning from failure via censors**: Don't just remember what works — remember what *doesn't* work, and the conditions under which it fails. Censor memories say "don't do X in situation Y." This is a distinct learning mode from positive reinforcement, and Minsky argues it's at least as important.

### 2.6 Control: Hierarchies, Heterarchies, and B-Brains

| Minsky Concept | Definition | Software Implementation |
|---|---|---|
| **Hierarchy** | Tree structure where each agent reports to one supervisor | Standard orchestration pattern |
| **Heterarchy** | Cross-connected network where agents need each other | Bidirectional dependencies, peer-to-peer |
| **Cross-Exclusion** | Competing agents inhibit each other — only one can be active | Mutex / winner-take-all selection |
| **Noncompromise** | When agents conflict too long, suppress both and try a third | Timeout + fallback strategy |
| **B-Brain** | Supervisory layer that observes A-brain without direct world contact | Meta-agent / observer / monitor |

**Key principle**: There is no central controller. Control is distributed. When conflicts arise, they migrate upward through hierarchical levels. If unresolved, the Noncompromise principle kicks in — suppress the conflicting agents and let a different agency try.

**B-Brains** are supervisory agents that watch other agents without understanding their domain. A B-brain can detect patterns like confusion (agent cycling), repetition, excessive detail, or insufficient detail — and intervene. You can stack B-brains (C watches B watches A) but too many layers risk instability.

### 2.7 Development and Learning

| Minsky Concept | Definition | Software Implementation |
|---|---|---|
| **Papert's Principle** | Growth comes from building new administrative systems over existing skills | Layered capability development |
| **Attachment Learning** | Trusted source shifts learning from "how" to "what goals" | Supervised fine-tuning from trusted feedback |
| **Functional Autonomy** | Subgoals become independent goals detached from their origin | Emergent agent behaviors |
| **Investment Principle** | Well-developed skills attract more use, compounding advantage | Preferential routing to proven agents |
| **Exception Principle** | Changing a heavily-used skill is costly — disruption exceeds gain | Stability bias for core agents |

### 2.8 Realms and Analogy

| Minsky Concept | Definition | Software Implementation |
|---|---|---|
| **Realm** | Division of thought with distinct representations (physical, social, possessional, psychological) | Domain-specific agency clusters |
| **Paranome** | Agent operating across multiple realms simultaneously | Cross-domain mapping agent |
| **Cross-Realm Correspondence** | Systematic analogies between realms enabling skill transfer | Analogy engine / metaphor library |
| **Uniframe** | Common structure applying across multiple contexts | Shared abstract schema |

---

## 3. System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        B-BRAIN LAYER                            │
│                                                                 │
│  Meta-agents that observe without participating:                │
│  - ConfusionDetector: spots agents cycling or stuck             │
│  - ConflictMonitor: detects prolonged agent disagreements       │
│  - ProgressTracker: monitors difference-engine convergence      │
│  - CensorRegistry: maintains "don't do X in Y" memories        │
│  - PerformanceObserver: tracks which agents contribute to       │
│    successful outcomes (credit assignment)                      │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                       AGENCY LAYER                              │
│                                                                 │
│  Composite agencies that coordinate agent groups:               │
│  - GoalManager: difference-engines driving toward objectives    │
│  - ConflictResolver: hierarchy + cross-exclusion + noncompromise│
│  - FrameSelector: matches situations to best-fit frames         │
│  - MemoryManager: K-line creation, retrieval, level-banding     │
│  - RealmCoordinator: manages paranome cross-domain mappings     │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                       AGENT LAYER                               │
│                                                                 │
│  LLM-backed specialized reasoners + deterministic utilities:    │
│  - Each agent: focused system prompt + scoped tools             │
│  - Communicate via polyneme bus (pub/sub event system)          │
│  - Use pronomes for temporary role bindings                     │
│  - Execute within frame-based knowledge structures              │
│  - Report activity to K-line memory system                      │
│  - Subject to censor/suppressor guards                          │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                    K-LINE MEMORY STORE                           │
│                                                                 │
│  Distributed long-term memory:                                  │
│  - Activation snapshots: which agents were active + context     │
│  - Level-banded: strong core fields + weak fringe defaults      │
│  - Hierarchical: K-lines referencing K-lines (knowledge trees)  │
│  - Similarity retrieval via vector embeddings                   │
│  - Temporal decay on fringe elements                            │
│  - Censor memories: "situation X → don't do Y"                  │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                   FRAME KNOWLEDGE BASE                          │
│                                                                 │
│  Stereotype templates with typed terminal slots:                │
│  - Default fillers for missing information                      │
│  - Trans-frames for action sequences (Actor→Action→Recipient)   │
│  - Frame-arrays for multi-perspective reasoning                 │
│  - Recognizers (input pattern detection) and                    │
│    Memorizers (state storage/activation)                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 3.1 Agent Implementation

Each agent in the society is an LLM-backed service with:

- **System prompt**: Defines the agent's specialty, constraints, and role within the society
- **Tools**: Scoped tool access relevant to the agent's domain (e.g., a memory-retrieval agent has vector search tools; a censor agent has access to the failure registry)
- **Signal interface**: Subscribes to relevant polynemes on the bus, emits signals when it has results
- **Context window**: Receives the current pronome bindings, active frame, and relevant K-line excerpts — not the entire system state

Some agents don't need full LLM reasoning and can be implemented as deterministic functions — routing agents, timer-based demons, cross-exclusion arbiters, event loggers. The architecture doesn't require every agent to be LLM-backed, only that agents *can* reason when their domain demands it.

**Agent lifecycle**: Agents are activated by incoming signals, perform their specialized reasoning, emit results as new signals, and return to dormancy. They don't maintain internal state between activations — all persistent state lives in K-lines, frames, and the context store.

### 3.2 The Polyneme Bus (Inter-Agent Communication)

The central nervous system of the architecture. A pub/sub event bus where:

- **Publishers** emit named signals (polynemes)
- **Subscribers** each interpret the signal in their own way
- **Isonomes** are special system-wide signals with uniform effects (e.g., "shift attention", "increase detail level")
- **Pronomes** are temporary bindings maintained in a context store

No agent needs to know what other agents do with a signal. This enables loose coupling and emergent coordination.

#### Signal Envelope

Every message on the bus is wrapped in a standard envelope:

```
{
  id:          string       // unique event ID (ULID for time-ordering)
  timestamp:   ISO-8601     // when the signal was emitted
  source:      AgentId      // who emitted it
  signal:      string       // the polyneme name (e.g., "block.found", "goal.achieved")
  type:        "polyneme" | "isonome" | "pronome-bind" | "censor" | "activation"
  payload:     any          // signal-specific data
  context: {
    pronomes:  Record<string, AgentId>   // current role bindings (Actor, Goal, etc.)
    frame:     FrameId | null            // active frame at time of emission
    klines:    KLineId[]                 // K-lines that influenced this signal
    micronemes: number[]                 // contextual embedding vector
  }
  causedBy:    EventId | null            // parent event that triggered this one
}
```

This envelope makes every signal fully traceable. The `causedBy` field creates a causal chain — you can walk backward from any event to reconstruct the full decision path.

#### Communication Patterns

Agents communicate through five distinct patterns on the bus, each mapping to a Minsky concept:

```
1. POLYNEME BROADCAST (one-to-many, heterogeneous interpretation)
   ┌─────────┐    "block.found"    ┌──────────┐
   │  Find   │ ──────────────────► │  Grasp   │  interprets as: "prepare to grip"
   │  Agent  │ ──────────────────► │  Move    │  interprets as: "plan path to block"
   └─────────┘ ──────────────────► │  Builder │  interprets as: "ready for next step"
                                   └──────────┘

2. ISONOME SYSTEM SIGNAL (one-to-all, uniform effect)
   ┌──────────┐   "attention.shift"   ┌─── All Agencies ───┐
   │ B-Brain  │ ────────────────────► │ Each increases      │
   └──────────┘                       │ vigilance uniformly │
                                      └─────────────────────┘

3. PRONOME BINDING (context assignment)
   ┌──────────┐   pronome-bind: {role: "Actor", agent: "ChildAgent"}
   │  Frame   │ ──────────────────► Context Store
   │ Selector │   pronome-bind: {role: "Goal", agent: "TowerTop"}
   └──────────┘ ──────────────────► Context Store

4. CROSS-EXCLUSION (mutual inhibition)
   ┌──────────┐                  ┌──────────┐
   │ Builder  │ ◄── inhibit ──► │ Wrecker  │   Only one can be active.
   └──────────┘                  └──────────┘   Winner determined by
                                                supervisor priority.

5. K-LINE ACTIVATION (memory recall → agent reactivation)
   ┌──────────┐   retrieve      ┌──────────┐   reactivate    ┌─── Agents ───┐
   │ Trigger  │ ──────────────► │  K-Line  │ ──────────────► │ Find, Grasp, │
   │ (similar │                 │  Memory  │                  │ Move, Put    │
   │  problem)│                 │  Store   │                  │ (as before)  │
   └──────────┘                 └──────────┘                  └──────────────┘
```

#### Audit Trail

**Every signal is persisted to an append-only event log.** This log is the ground truth for the entire system's behavior and serves three purposes:

1. **Debugging**: Replay any sequence of events to understand what happened and why
2. **K-Line creation**: When a task succeeds, the relevant event subsequence becomes the raw material for a new K-line
3. **Introspection**: The B-Brain layer and external introspection apps consume this log in real-time

The event log is structured as a time-ordered stream with causal links:

```
EventLog:
  ├── event-001: Find emitted "block.found"           causedBy: null
  ├── event-002: Grasp received "block.found"          causedBy: event-001
  ├── event-003: Move received "block.found"           causedBy: event-001
  ├── event-004: Grasp emitted "grip.ready"            causedBy: event-002
  ├── event-005: CensorRegistry checked "block.reuse"  causedBy: event-001
  ├── event-006: Move emitted "path.planned"           causedBy: event-003
  └── ...
```

### 3.7 The Introspection App (B-Brain Interface)

Minsky's B-Brain concept — a supervisory layer that observes the A-Brain (the working agents) without participating in the domain — maps directly to an introspection application.

#### Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    INTROSPECTION APP                      │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │  Agent Graph  │  │  Event Flow  │  │  Memory View  │  │
│  │  (who's on)   │  │  (signals)   │  │  (K-lines)    │  │
│  └──────┬───────┘  └──────┬───────┘  └───────┬───────┘  │
│         │                 │                   │          │
│  ┌──────┴─────────────────┴───────────────────┴───────┐  │
│  │              Event Stream Consumer                  │  │
│  └─────────────────────┬──────────────────────────────┘  │
│                        │                                 │
├────────────────────────┼─────────────────────────────────┤
│                        │  (read-only event stream)       │
│    ┌───────────────────▼───────────────────────────┐     │
│    │              AUDIT EVENT LOG                    │     │
│    │         (append-only, all signals)              │     │
│    └───────────────────────────────────────────────┘     │
│                     AGENT SOCIETY                         │
└──────────────────────────────────────────────────────────┘
```

The introspection app is **strictly read-only** — it consumes the event log but never injects signals back into the agent society. This preserves Minsky's insight that B-Brains observe without participating.

#### Views

1. **Agent Activation Graph**: Real-time visualization of which agents are active/dormant. Shows agencies as nested groups. Highlights cross-exclusion conflicts (two agents fighting for the same slot).

2. **Event Flow Timeline**: Chronological stream of polyneme signals with causal links. Filter by agent, signal type, or frame. Click any event to see its full envelope including pronome context and K-line references.

3. **Memory View**: Browse K-line store. See which K-lines were retrieved for the current task. Visualize level-banding (core vs. fringe confidence). Show knowledge-tree hierarchy.

4. **Conflict Dashboard**: Active cross-exclusion battles. Noncompromise firings (both sides suppressed). Censor/suppressor triggers with the conditions that fired them.

5. **Goal Progress**: Difference-engine state — current vs. desired, with gap visualization. Shows which agents are working to close which gaps.

6. **Causal Trace**: Select any outcome and walk backward through the `causedBy` chain to see exactly which signals and agent activations led to it. This is the primary debugging tool.

### 3.3 K-Line Memory System (Long-Term Memory)

The heart of the system's memory:

1. **Capture**: When a task succeeds, snapshot which agents were active, what frame was in use, what pronome bindings were set, and the context (micronemes)
2. **Store**: Persist the snapshot with a vector embedding for similarity search, plus structured metadata for exact-match queries
3. **Retrieve**: On new problems, find similar K-lines by vector similarity. Reactivate the recorded agent set to recreate a similar "mental state"
4. **Level-Band**: Each field in a K-line has a confidence weight. Core fields (high confidence) persist indefinitely. Fringe fields (low confidence) serve as defaults and decay over time or are easily overridden
5. **Hierarchy**: K-lines can reference other K-lines, forming knowledge-trees. Higher-level K-lines capture abstract patterns; lower-level ones capture specifics

### 3.4 Frame Engine (Knowledge Representation)

Frames are the system's way of representing what it knows about typical situations:

1. **Frame Definition**: Schema with named terminals (slots), each with a type, default filler, and confidence level
2. **Frame Matching**: When a situation arises, find the best-matching frame(s). Use locking-in (mutual support among matching frames) to select the winner
3. **Default Filling**: Unfilled terminals get default values (weak confidence). Override with specifics as they arrive
4. **Trans-Frames**: Action templates binding pronome roles (Actor, Action, Origin, Destination, Instrument, Goal)
5. **Frame-Arrays**: Multiple related frames sharing terminals — enables perspective-switching

### 3.5 Difference-Engine (Goal Pursuit)

The mechanism that creates apparent intentionality:

1. Maintain a representation of the **desired state** (goal frame)
2. Continuously compare to **current state**
3. Identify **differences**
4. Activate agents whose job is to reduce specific differences
5. Continue until differences are eliminated or a censor/timeout fires

### 3.6 Censor/Suppressor System (Learning from Failure)

A parallel learning track to positive memory:

- **Suppressors**: Trigger after a bad outcome. Record: "When I was in state S and did action A, the result was bad." Block action A when state S recurs
- **Censors**: Trigger before a bad outcome. Recognize precursor states and deflect before the bad action is even considered. More efficient but harder to learn
- **Demons**: Always-on watchers for specific dangerous conditions

---

## 4. Implementation Plan

### Phase 1: Foundation

Build the core infrastructure:

1. **Agent base class** — LLM-backed agent with system prompt, scoped tools, signal interface, and lifecycle management. Also supports deterministic (non-LLM) agents for routing, timing, and arbitration
2. **Agency container** — manages a group of agents, routes signals, presents unified interface
3. **Polyneme bus** — pub/sub event system with isonome and pronome support, append-only event log
4. **Context store** — pronome bindings, microneme context, current frame reference
5. **Introspection event stream** — real-time read-only access to the audit log for the B-Brain layer and external apps

### Phase 2: Memory

Build the K-line memory system:

1. **K-Line schema** — activation snapshot format with level-banding
2. **Vector store integration** — similarity-based K-line retrieval (Pinecone or similar)
3. **Memory manager agency** — handles capture, storage, retrieval, decay
4. **Hierarchical K-lines** — K-lines referencing K-lines, knowledge-tree indexing

### Phase 3: Knowledge

Build the frame engine:

1. **Frame schema** — terminals with types, defaults, confidence levels
2. **Frame matching** — recognizer agents that detect when a frame applies
3. **Frame-arrays** — perspective-switching via shared terminals
4. **Trans-frames** — action templates with pronome role slots

### Phase 4: Goals and Control

Build the control mechanisms:

1. **Difference-engine** — goal representation + gap detection + agent activation
2. **Conflict resolution** — hierarchy, cross-exclusion, noncompromise
3. **Censor/suppressor registry** — failure memory + guard evaluation
4. **B-brain observer** — meta-agent layer monitoring for confusion, loops, stalls

### Phase 5: Demo Society

Build a working demonstration:

1. **Builder scenario** — recreate Minsky's block-building example
   - Builder agency (composed of Find, Get, Put sub-agents)
   - See, Move, Grasp agents at the lowest level
   - Frame-based block/tower knowledge
   - K-line memories of successful builds
   - Censors for "don't reuse blocks already in the tower"
2. **Conversational agent** — a society that can discuss topics
   - Language-frames for understanding
   - Memory retrieval for relevant past conversations
   - Multiple realm support (factual, social, emotional)

---

## 5. Key Architectural Decisions

1. **Agents are LLM-backed reasoners** — each agent can think within its domain; the society provides memory, coordination, and structure that no individual agent has
2. **No central controller** — intelligence emerges from agent interactions, not a homunculus
3. **Conflict is healthy** — agents disagree; resolution mechanisms (hierarchy, cross-exclusion, noncompromise) handle it
4. **Memory is distributed** — K-lines capture *which agents were active*, not raw data dumps
5. **Defaults everywhere** — frames pre-fill with assumptions; new info overrides weak defaults
6. **Learning from failure is first-class** — censors/suppressors are as important as positive memories
7. **Layered development** — each new capability layer builds on the previous stable layer
8. **Multiple realms** — separate agencies for different domains, connected by paranomes for cross-domain analogy
9. **No synchronous "now"** — each agent has different temporal experience; don't assume global clock
10. **Self-knowledge is limited by design** — not all agent internals should be introspectable (prevents harmful self-modification)
11. **Circular causality is expected** — agents mutually reinforce; don't force linearization
12. **Observable by default** — every signal is logged; the introspection app is not optional, it is how we understand what the society is doing

---

## 6. Glossary of Minsky Terms Used in This Architecture

- **Agent**: Specialized reasoner. Capable within its domain, ignorant of the larger picture. Typically LLM-backed.
- **Agency**: Group of agents seen as unified capability from outside.
- **B-Brain**: Supervisory agent that observes without participating in the domain.
- **Censor**: Blocks bad actions *before* they happen by recognizing precursor states.
- **Cross-Exclusion**: Mutual inhibition — only one of a competing set can be active.
- **Default Assumption**: Weak belief used when no better info exists. Easily overridden.
- **Demon**: Always-on watcher for a specific condition.
- **Difference-Engine**: Compares current vs. desired state; activates agents to close gaps.
- **Frame**: Knowledge template with slots (terminals) and default fillers.
- **Frame-Array**: Family of frames sharing terminals for multi-perspective reasoning.
- **Isonome**: System-wide signal with uniform effect on all agencies.
- **K-Line**: Memory snapshot of which agents were active during a successful episode.
- **Level-Band**: Confidence gradient — strong core + weak fringes in a K-line.
- **Microneme**: Subtle context signal that shades interpretation.
- **Noncompromise Principle**: When agents conflict too long, suppress both and try a third.
- **Paranome**: Agent operating across multiple realms simultaneously.
- **Polyneme**: Signal interpreted differently by each receiving agency.
- **Pronome**: Temporary role binding (the current Actor, Goal, etc.).
- **Realm**: Domain-specific division of the mind with distinct representations.
- **Suppressor**: Blocks bad actions *after* recognizing the undesired state occurred.
- **Trans-Frame**: Action template with role slots (Actor, Action, Origin, Destination).
- **Uniframe**: Abstract structure that applies across multiple contexts.

---

## References

- Minsky, Marvin. *The Society of Mind*. Simon & Schuster, 1986.
- Reference text: `reference/society_of_mind.md` (converted from epub at github.com/ttn114/societyofmind)
