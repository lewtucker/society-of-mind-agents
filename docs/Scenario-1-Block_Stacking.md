---
title: "Scenario 1: Block Stacking"
version: "1.0"
date: 2026-04-01
author: Lew Tucker
status: Draft
document-id: SOM-SCN1
changelog:
  - version: "1.0"
    date: 2026-04-01
    summary: Initial scenario writeup — block tower demonstration of core SoM mechanics
---

# Scenario 1: Block Stacking

This scenario is the example Minsky uses throughout *The Society of Mind*. A society of agents builds a tower out of blocks. It is the demonstration scenario for the Phase 5 implementation and the simulation running in the introspection app.

It exercises the following core mechanics in a single, observable run:
- Polyneme fan-out (concurrent agent activation from one signal)
- Frame-based goal representation and difference-engine convergence
- K-line capture on success (positive memory)
- K-line retrieval assisting a subsequent step (memory improving behavior)
- Censor firing to prevent a known-bad action (failure learning)
- B-Brain observation throughout without participation

---

## The Goal

Build a tower of height 3.

The society receives this as a `goal.set` signal directed at **GoalManager**. GoalManager activates a difference-engine:

```
desired state:  tower(height=3)
current state:  empty
gap:            3 blocks to place
```

The difference-engine persists until the gap is closed. GoalManager does not know *how* to stack blocks — it just holds the goal representation and monitors convergence.

---

## Frame Selection

**FrameSelector** activates and retrieves the `Builder` frame from the frame knowledge base.

The Builder frame has the following terminal slots:

| Terminal | Default filler | Confidence |
|---|---|---|
| target | tower | core |
| height | unknown | fringe (filled by goal) |
| sub-agents | [Builder, Find, Grasp, Move, Put, See] | core |
| step-sequence | [find, grasp+move, put] | core |
| completion-check | height reached | core |

On the first run, the frame is retrieved from the built-in frame library at high confidence (0.94). On subsequent runs, a K-line for "Builder frame retrieval" may further accelerate this step.

---

## Stepping Through Each Block (×3)

The same sub-sequence runs for each of the three blocks. The mechanics are identical; what changes is that memory assists on block 2, and a censor intervenes on block 3.

### 1. Builder Activates

**Builder** is the coordinating agent for this task. It knows the sequence of steps and which polynemes to emit at each step. It does not know how to physically find, grip, or place blocks — that knowledge lives in the specialist agents below it.

This is the Agent/Agency duality: Builder is an agent when viewed from GoalManager above, and an agency when viewed from Find/Grasp/Move/Put below.

Builder emits `builder.step` and begins step 1.

### 2. Find + See Fire Concurrently

Builder emits `block.search` — a **polyneme**. Both **Find** and **See** subscribe to this signal and activate simultaneously in separate containers:

- **See** parses the current scene and extracts the positions and availability of all blocks in the environment
- **Find** uses See's output to identify which blocks are candidates: not already in the tower, reachable, correct size

Neither Find nor See knows why it is being asked. Neither knows what the other is doing. They react to the same signal in their own way.

Find emits `block.found` with the selected block's ID and position.

**This is the first concurrency point in the scenario.** Two agents are reasoning simultaneously from a single polyneme. The introspection app shows both cards active at the same time.

### 3. Grasp + Move Fire Concurrently on block.found

`block.found` is another polyneme. Both **Grasp** and **Move** subscribe to it and activate simultaneously:

- **Grasp** interprets `block.found` as: "prepare to grip this block" → reasons about grip angle, force, approach → emits `grip.ready`
- **Move** interprets `block.found` as: "plan a path from here to this block, and from the block to the tower top" → emits `path.planned`

Neither agent knows what the other is doing. Neither knows the overall goal. The same signal (`block.found`) triggers completely different reasoning in each subscriber — this is the defining property of a polyneme.

**This is the second concurrency point.** Grasp and Move are both active simultaneously. In a real physical system, this is what allows gripper preparation and path computation to happen in parallel rather than sequentially.

### 4. Put Executes

Once both `grip.ready` and `path.planned` are available, **Put** activates and places the block at the tower top.

Put emits `put.execute`, then goes dormant. One block of the tower is now complete.

### 5. MemoryManager Captures a K-Line

On success (block placed without error), **MemoryManager** creates a positive K-line. It snapshots:

- Which agents were active: Builder, Find, See, Grasp, Move, Put
- What frame was in use: Builder frame
- What pronome bindings were set: Actor=Builder, Object=block, Destination=tower-top
- The event subsequence from the audit log (causal chain)

**Level-banding assignment:**

| Band | Agents | Rationale |
|---|---|---|
| Core | Builder, Put | On the critical causal path |
| Peripheral | Find, See | Contributed but replaceable |
| Fringe | Grasp, Move | Active but their outputs could have come from different agents |

The K-line is embedded and stored. Fringe fields decay over 30 days; core fields persist indefinitely.

---

## Block 2: Memory Assists

On the second block, the situation is highly similar to block 1: same goal, same frame, same agent configuration. **MemoryManager** retrieves the K-line from step 1 with a similarity score of 0.91.

What this provides:

- The retrieved K-line's core-band agents are pre-loaded as the expected activation set
- The Builder frame's fringe defaults are already filled from the previous step (e.g., expected block position range)
- Find locates the block faster because the system is already in a "similar mental state"

This demonstrates the central K-line theory claim: *reactivating a K-line puts the system in a similar state to when the K-line was created — making the same agents available, with the same defaults pre-loaded.*

MemoryManager and Find are both active simultaneously during retrieval — Find is already searching while the K-line is being loaded.

---

## Block 3: The Censor Fires

On the third block, Find identifies a candidate: Block C. But Block C is already in the tower.

Without a censor, Find would commit to Block C. Downstream, Put would attempt to place it at the tower top — but it is already part of the structure. The tower would fall.

**MemoryManager** holds a censor entry:

```
precursor:  block X is already in the tower structure
action:     do NOT select block X as a candidate
reason:     attempting to reuse a tower block causes structural failure
```

This censor fires *before* Find commits to Block C — before the bad action is even taken. The signal `censor.fire` appears in the event feed (red). Find receives the block result as an implicit "blocked" response and selects Block D instead.

**This is the key distinction between censors and suppressors:**
- A **suppressor** fires *after* the bad outcome occurs and blocks the same action next time
- A **censor** fires *before* the bad action is taken, by recognizing the precursor state

In the simulation, the censor is already in place (it would have been created on a prior run where the system tried to reuse a block and failed). The run that created it is not shown — only the consequence: Block D is used instead of Block C, and the tower is completed successfully.

---

## Goal Achieved + Final K-Line

After block 3, Put emits `put.execute` for the final time. GoalManager checks the difference-engine: current state now matches desired state. Gap = 0.

GoalManager emits `goal.achieved`.

**MemoryManager** captures a final K-line representing the entire build sequence. This K-line:

- References the three step K-lines as children (`child_ids`)
- Is typed as `abstract` — a higher-level pattern
- Core band: Builder, GoalManager, Put
- Fringe: all others (more peripheral at the sequence level)

This is the beginning of a **knowledge-tree**: the abstract K-line captures the pattern "three-step block placement achieves tower(3)" without the specific details of which blocks were used or their exact positions. On a future run with `tower(4)`, this abstract K-line would activate alongside four step-level K-lines.

---

## What the B-Brains Are Doing

**ConfusionDetector**, **ConflictMonitor**, and **ProgressTracker** are in `watching` state throughout — always active, never dormant.

In this scenario they are silent because the run completes cleanly. In a real run they would intervene if:

| B-Brain | Would fire when |
|---|---|
| ConfusionDetector | Find keeps emitting `block.found` for the same block without Put consuming it — signals a loop |
| ConflictMonitor | Builder and another agency are simultaneously pursuing conflicting goals — signals a cross-exclusion failure |
| ProgressTracker | The difference-engine stalls — gap stops decreasing over multiple steps |

The B-Brain layer observes without participating. None of its agents emit polynemes into the society's working bus. Their outputs go to the introspection log only. This is Minsky's B-Brain design: a supervisory layer that watches the A-Brain without contaminating it.

---

## What This Scenario Demonstrates

| Mechanic | Where it appears |
|---|---|
| Polyneme fan-out | `block.search` → Find + See simultaneously; `block.found` → Grasp + Move simultaneously |
| Frame-based knowledge | Builder frame with terminal slots and defaults |
| Difference-engine | GoalManager holding goal until gap=0 |
| Concurrent agents | Two separate concurrency points per step |
| K-line capture | After each successful block placement |
| K-line retrieval | Block 2: memory pre-loads agent configuration |
| Censor firing | Block 3: Block C rejected before selection committed |
| Knowledge-tree | Final abstract K-line referencing step K-lines as children |
| B-Brain observation | Throughout — watching without acting |

---

## Simulation vs. Real Implementation

The introspection app simulation runs this scenario as a timed state machine — agents activate on a schedule rather than in response to real signals. The real implementation (Phase 5) will:

- Replace the timer with actual polyneme bus signals
- Replace mock K-line creation with real SQLite writes via MemoryManager
- Replace the censor simulation with a real censor registry lookup
- Run each agent in its own container with a real LLM backing its reasoning

The scenario structure — the sequence of signals, the agent activation pattern, the K-line and censor mechanics — is identical in both cases. The simulation is the spec; the Phase 5 implementation executes it.
