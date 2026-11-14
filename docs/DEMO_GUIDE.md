---
title: Demo Guide — Running the Society of Mind System
version: 1.1
date: 2026-04-05
author: Lew Tucker
status: living
changelog:
  - 1.1 (2026-04-05): Added Admin Panel, Next Step button, seed-demo, converse REPL,
      Cross-Society Retrieval and Learning Curve demos. Updated Getting Started.
  - 1.0 (2026-04-03): Initial version
---

# Demo Guide — Running the Society of Mind System

---

## Getting Started

### Prerequisites

```bash
node --version   # 20+ required
npm --version    # 9+ required
```

No external services needed. All demos run deterministically without an API key.

### Install dependencies (once)

```bash
cd src/core         && npm install
cd src/introspection && npm install
```

### Start the introspection app

```bash
cd src/introspection && npm run dev
# Opens http://localhost:3000
```

> `npm run dev` clears the Next.js build cache (`.next/`) on every start.
> This prevents React hydration errors after code changes. Always use this
> command — never `npx next dev` directly.

### What you see on first load

The app opens in **simulation mode**: a 30-frame block-stacking animation
that plays one step at a time using the **Next Step →** button in the header.

| Header element | What it means |
|---|---|
| `step 1 / 30` | Current frame in the simulation |
| **Next Step →** | Advance one frame manually |
| **Reset** | Return to frame 1, clear the event feed |
| `OBSERVE` badge | System mode — OBSERVE (default) or ACT |
| `●  live` / `●  connecting…` | SSE connection status |

Simulation mode uses no database. The **▼ Admin** bar below the header
lets you run real demos that write to `~/.som/`.

---

## Admin Panel

Click **▼ Admin** just below the header to expand the controls.

### Run Demo

A dropdown with three pre-built demos. Select one and click **▶ Run**.
Output streams into the log panel in real time while the event feed updates live.

| Demo | What it does |
|------|-------------|
| **Block Builder** | 3-block tower build — agents coordinate via polyneme bus, K-line captured on success |
| **Cross-Society Retrieval** | Block build followed by 3 conversation turns about tower building — shows conversation agents finding builder K-lines |
| **Learning Curve** | 5 builds in sequence — watch K-line count and retrieval scores improve over time |

After any demo runs, the app switches from simulation mode to **live mode**
(reading `~/.som/events.db`). The Next Step button disappears; the event feed
shows real events from the log.

### Clear All Data

Deletes `~/.som/events.db` and `~/.som/klines.db` (two-step confirm).

**After clearing:** stop the dev server (Ctrl+C) and restart it:

```bash
cd src/introspection && npm run dev
```

This returns the app to simulation mode with a clean build.

---

## Demo 1: Block Builder

### What It Is

Five deterministic agents (FindAgent, SeeAgent, GraspAgent, MoveAgent, PutAgent)
build a tower by passing signals through the polyneme bus. Demonstrates agent
coordination, K-line capture on success, and the censor guard firing on a
known-bad action.

This is Minsky's original block-stacking example from *The Society of Mind*,
implemented as a running system.

### Running It

**Via Admin Panel:** Select **Block Builder** → **▶ Run**

**Via terminal:**
```bash
cd src/core && npm run seed-demo
```

### What to Observe

**Signal chain for each block**

```
task.start
  → block.found (block-A)
    → block.described → grip.ready → block.placed → placement.confirmed
      → block.found (block-B)   ← FindAgent reacts to placement.confirmed
        → ...
          → task.succeeded
```

Each block's full chain fires before the next block starts. No orchestrator
decides who acts — each agent subscribes to the signal it cares about and
reacts independently.

**K-line capture on task.succeeded**

The `memory-capture-agent` walks the causedBy chain, classifies agents into
bands (find-agent + put-agent in core; others in peripheral/fringe), embeds
the description, and writes to `~/.som/klines.db`. You'll see
`kline.captured` appear in the event feed.

**Censor pre-seeded**

`seed-demo` pre-seeds a censor K-line for `grasp_block`. Test it in the
Query Panel: **Censor Check** → situation `block tower build` +
action `grasp_block` → should show **⚠ CENSOR FIRES**.

---

## Demo 2: Cross-Society Retrieval

### What It Is

Runs a block build, then immediately runs three conversation turns asking
about "block stacking" and "tower building". The Conversational Society's
RetrievalAgent searches the same `~/.som/klines.db` — and finds K-lines
captured by the block-builder.

This demonstrates the core cross-society claim: **memory is shared across
societies via the K-line store**. The conversation agents never saw the
block build — they only see its K-lines.

### Running It

**Via Admin Panel:** Select **Cross-Society Retrieval** → **▶ Run**

**Via terminal:**
```bash
cd src/core && npm run demo:cross-society
```

### What to Observe

Watch the Admin Panel output log:

```
━━━ Step 1: Block Builder Society ━━━
Running 3-block tower build…
✓ Build complete. K-lines: 2

━━━ Step 2: Conversational Society ━━━
Q: tell me about block stacking
A: Responding to: "tell me about block stacking" (no prior memories)
   Memories retrieved: 0

Q: how does tower building work
A: Responding to: "how does tower building work" (drawing on 1 memory)
   Memories retrieved: 1  ← found the builder's K-line
```

The first conversation turn retrieves nothing (no conversation K-lines yet).
The second and third turns retrieve the block-builder K-lines — cross-society
memory in action.

After the run, open the **Memory Feedback Graph** — you'll see both builder
agents and conversation agents connected to K-lines in the same graph.

---

## Demo 3: Learning Curve

### What It Is

Runs 5 block builds in sequence with a fresh bus per run (simulating separate
sessions). After each run, queries the K-line store and displays a score bar
showing how retrieval confidence improves as memory accumulates.

### Running It

**Via Admin Panel:** Select **Learning Curve** → **▶ Run**

**Via terminal:**
```bash
cd src/core && npm run demo:learning-curve
```

### What to Observe

```
Run 1  K-lines:  2  top score: [████░░░░░░░░░░░░░░░░] 22%
Run 2  K-lines:  4  top score: [████████░░░░░░░░░░░░] 40%
Run 3  K-lines:  6  top score: [████████████░░░░░░░░] 61%
Run 4  K-lines:  8  top score: [████████████████░░░░] 78%
Run 5  K-lines: 10  top score: [████████████████████] 95%
```

Each run adds a new K-line. On retrieval, the hybrid scorer (cosine
similarity + BM25 + temporal decay) finds more evidence for the same
situation pattern, raising the top score. This is K-line level-banding in
action: the system grows more confident about what works as it accumulates
experience.

After this demo, open **Memory Probe** in the Query Panel and type
`block tower build` — you'll see multiple K-lines returned, ranked by score.

---

## Demo 4: Conversational Society REPL

### What It Is

An interactive REPL that wires all agents — block-builder AND conversational —
onto a single shared bus and K-line store. Type questions; the system extracts
a topic, retrieves relevant K-lines, generates a response, and captures the
turn as a new K-line.

Run `/build` from inside the REPL to trigger a block build mid-conversation.

### Running It

```bash
cd src/core && npm run converse
```

### What to Observe

```
you> tell me about block stacking
som> Responding to: "tell me about block stacking" (no prior memories)

you> how does tower building work
som> Responding to: "how does tower building work" (drawing on 1 memory)
     (retrieved 1 K-line from memory)

you> /build
building… Tower built: block-A, block-B, block-C
K-lines in store: 4

you> block tower build
som> Responding to: "block tower build" (drawing on 2 memories)
     (retrieved 2 K-lines from memory)  ← now finds builder K-lines too
```

Key moment: after `/build`, asking about block stacking retrieves **both**
the conversation K-line from the first turn **and** the builder K-line from
the build — the two societies sharing memory in real time.

---

## Using the Query Panel

After any demo, the Query Panel (below the agent grid) provides five query modes.

### Activation State

**Run query** with no input. Shows every agent seen in the event log and
its current active/dormant state.

### Causal Trace

Copy any event ID from the **Event Feed** (the faint ULID below each event
summary). Paste it into the Causal Trace input and **Run query**.

Walks the `causedBy` chain backwards to the root signal, showing the full
sequence of cause and effect. The `kline.captured` event is a good starting
point — it traces back through `task.succeeded` → `placement.confirmed` →
... → `task.start`.

> **Note:** Causal Trace only works in live mode (real ULID IDs from `~/.som/events.db`).
> The simulation's `evt-12` style IDs are synthetic and not in the log.

### Memory Probe

Type a situation description and **Run query**. Returns K-lines ranked by
similarity with band pills and scores.

Good queries to try:
```
block tower build
grasp place stack
conversation block stacking
```

### Censor Check

Fill in a **situation** and **action**, then **Run query**.
Returns **⚠ CENSOR FIRES** if a matching censor K-line exists, or **✓ Clear** if not.

```
situation: block tower build
action:    grasp_block       → ⚠ FIRES (pre-seeded censor)

situation: block tower build
action:    move_block        → ✓ Clear
```

### Reasoning Probe

Requires a live LLM-backed agent (not yet wired in the current demos).
Returns stub response.

---

## Memory Feedback Graph

Scroll below the Query Panel to see the SVG directed graph.

- **Circles (left)** — agents that participated in captured K-lines
- **Hexagons (right)** — K-lines, colored by type (green=positive, red=censor)
- **Edges** — agent → K-line associations
  - Thick solid = **core** (critical path agents)
  - Medium solid = **peripheral**
  - Thin dashed = **fringe**

The graph is empty until at least one demo has run and written K-lines.
Run the **Learning Curve** demo for the richest graph — 10 K-lines with
multiple agent connections.

---

## Typical Demo Sequence

For a first-time walkthrough:

1. `npm run dev` — open http://localhost:3000 in simulation mode
2. Step through the 30-frame simulation with **Next Step →** to see the
   signal sequence and agent state changes
3. Open **▼ Admin** → run **Block Builder** → watch the event feed populate
4. Run **Memory Probe** with `block tower build` → see the K-line card
5. Run **Censor Check** with situation `block tower build` + action `grasp_block`
6. Open **▼ Admin** → run **Cross-Society Retrieval** → watch the output log
7. Run **Memory Probe** again — now shows both builder and conversation K-lines
8. Open **▼ Admin** → run **Learning Curve** → watch scores improve
9. Open the **Memory Feedback Graph** — a rich graph of agent→K-line connections

---

## Connecting the Demo to Minsky's Book

| Demo moment | Minsky chapter | Quote |
|-------------|---------------|-------|
| Signal chain (task.start → task.succeeded) | Chapter 1 "The agents of the mind" | "Each mental agent by itself can only do a simple thing that needs no mind or thought at all." |
| K-line capture on task.succeeded | Chapter 8 "K-lines: A theory of memory" | "When you 'get an idea' ... you save a partial state of mind." |
| Censor fires before bad action | Chapter 27 "Censors and exceptions" | "Once we learn something, we tend not to learn it again — we learn to prevent the error rather than repair the damage." |
| B-Brain watching without acting | Chapter 6 "B-brains" | "A B-brain can observe the activities of the A-brain and use this to influence it — without being enmeshed in those activities." |
| Cross-society retrieval | Chapter 8 "K-lines" | "A K-line is a wire that connects all the mental agents that were active at the time you solved some problem." |
| Learning curve (scores improving) | Chapter 8 "K-lines" | "The more K-lines you activate, the more of your old knowledge comes into play." |

The full book text is at `reference/society_of_mind.md`.
