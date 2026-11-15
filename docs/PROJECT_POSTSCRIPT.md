---
title: "Project Postscript — Findings and Lessons"
version: "1.0"
date: 2026-11-14
author: Lew Tucker
status: Final
document-id: SOM-POST
changelog:
  - version: "1.0"
    date: 2026-11-14
    summary: Initial postscript written at the close of the research exploration
---

# Project Postscript — Findings and Lessons

This project was a research exploration: could Marvin Minsky's *Society of Mind* (1986)
be turned into a working agent architecture with long-term memory? The exploration is
now complete. This postscript records what we learned, what we demonstrated, what we
never got to test, and how our view of the right next step changed by the end. It is
meant to be read alongside [FEASIBILITY.md](FEASIBILITY.md), which set out the questions
before the build, and [PROJECT_SUMMARY.md](PROJECT_SUMMARY.md), which describes the
design.

In brief: the most valuable idea in the project is Minsky's view of memory as
*re-creating a past state of mind* rather than storing facts. We built that idea from the
outside, as a society of separate agents with an external memory store. Looking back,
the idea may belong *inside* a language model, where memory could be retrieved by
selectively re-activating the model's own internal connections.

---

## 1. The Central Finding: Memory Re-creates a State

Most current agent systems treat memory in one of two ways:

- **Multi-agent debate** systems (AutoGen, CrewAI and similar) keep a shared message
  thread. Agents argue in turns, and "memory" is the transcript of what was said.
- **Retrieval-augmented generation (RAG)** retrieves passages of text and places them in
  the context window of a single LLM call. Memory is *content* fed to one reasoner.

Minsky's K-lines suggest a third answer. A K-line does not record *what was said* or
*what was known*. It records **which parts of the mind were active** when a problem was
solved, and how central each one was. Retrieving a K-line does not supply facts. It
**puts the mind back into the state that worked before**: the same specialists awake,
the same defaults loaded, the same frames primed. Minsky's phrase is that the mind
becomes "more like an earlier version of itself."

In this view, retrieval decides *what is thinking* about a problem, not just *what it
thinks with*. That property is missing from both debate systems and RAG, and it is the
part of Minsky's theory that looks most relevant today.

---

## 2. Where That Idea Belongs

### 2.1 What we built: memory from the outside

Minsky described K-lines in terms of the brain. A K-line attaches to the mental agents
that were active during an experience and, when triggered later, partly re-arouses them.
The "agents" are parts of one connected network, and memory works by restoring patterns
of activity within it.

This project had no such network to work with, so it rebuilt the picture from the
outside:

- **Agents** became separate programs that communicate through an event bus.
- **Activity** became signals written to an event log.
- **A K-line** became a database record listing the agents that took part in a success,
  grouped into core, peripheral and fringe bands by how close each was to the outcome.

The capture side works. When a task succeeds, `capturePositiveKLine()` walks the causal
chain in the event log, classifies each contributing agent and stores the snapshot.
Hybrid retrieval (vector similarity, BM25 full-text ranking, temporal decay and
diversity re-ranking) finds those snapshots again in later runs.

The step that would complete the idea was never built. Nothing takes a retrieved K-line
and *re-activates the agents it names*. Retrieved K-lines are used only to fill slots in
frames and, in the conversational demo, as context for a response, which is close to RAG
in shape. Closing that loop externally is possible, but it would still mean waking whole
programs based on a list of names. That is a coarse copy of what Minsky described.

### 2.2 What it might look like from the inside

A large language model already has what this project had to simulate: a vast network of
internal connections whose pattern of activity at any moment is its "state" while it
works on a problem. Different parts of that network respond to different kinds of
situations, much as Minsky's specialist agents do.

A memory system built into such a model could retrieve by **selectively lighting up the
relevant internal connections**, restoring a past pattern of activity rather than
reading back a description of it. That would be much closer to the K-line as Minsky
defined it. In that design:

- the society of agents lives largely *inside* the model, as specialized internal
  pathways rather than separate programs;
- a K-line is a pattern of internal activation, not a row in a table;
- recall changes how the model thinks, not just what it reads.

Research into model internals, such as finding interpretable features and steering a
model by adjusting its activations, suggests this is becoming technically approachable.
We did not attempt it, and it is a different project from the one built here. But it is
where we now think Minsky's memory idea most naturally fits.

### 2.3 What the external design still offers

The outside-in approach is not wasted. It has properties an internal memory would not
have on its own:

- **Every step is visible.** Each signal is logged with a pointer to its cause, so any
  outcome can be traced. Internal activations are far harder to read.
- **Memory is inspectable and editable.** A K-line or censor can be examined, corrected
  or deleted. An internal pattern cannot easily be.
- **Failure rules are explicit.** A censor says plainly what it blocks and why.

The likely end state is a combination: memory and specialization inside the model, with
an external society layer for the things that need to be explicit, such as audit trails,
safety rules, and coordination across tasks and sessions.

---

## 3. The Untested Step: LLM Agents

The architecture was designed from the start for agents backed by large language models.
The `Agent` class supports two modes: a deterministic handler written in code, or a
Claude model driven by the agent's system prompt. The plan was to build and verify the
society's machinery with simple coded agents first, then replace them with LLM agents
that reason in specialized domains while keeping the Society of Mind architecture.

**Because of time constraints, we never took that step.** Every agent in the system,
including the block-builder demo, the conversational demo and all the infrastructure
agents, runs as a deterministic function. The LLM path exists and its offline "stub"
mode is tested, but no LLM-backed agent ever ran in the society. The event log contains
no `agent.cost` events, which would have recorded token use.

Section 2 changes how we see that step. Placing LLM agents in the external society is
still the most direct way to answer the questions in [FEASIBILITY.md](FEASIBILITY.md):

- Do LLM agents with different priorities produce real disagreement, so that the
  conflict mechanisms have work to do?
- Can an LLM-backed retrieval agent judge *why* a past episode is relevant, instead of
  relying on overlapping words?
- Does K-line memory let the society route recurring problems to cheaper models over
  time?

But each LLM agent would bring its own internal network, and the society would be
re-activating whole models by name. The deeper version of the experiment is to ask how
much of the society, and its memory, could live inside a single model.

---

## 4. Other Findings

Each of these maps to a concern raised in [FEASIBILITY.md](FEASIBILITY.md), and each
looks different in light of Section 2.

### 4.1 The society collapsed into a pipeline (Feasibility §5.1)

Feasibility warned that without genuine disagreement the society would become a pipeline
with Minsky vocabulary. With deterministic agents, that is what happened. Both demos run
as fixed chains: `task.start → block.found → … → task.succeeded` and
`conversation.input → topic.identified → context.retrieved → conversation.response`.
Cross-exclusion and noncompromise are implemented and tested, but no agent in either demo
ever produces a conflict; they were exercised only with signals injected by tests.

**Lesson:** separately written agents connected by fixed subscriptions have no reason to
compete. In a network, many overlapping parts respond to the same situation at once and
must be resolved, which is closer to the competition Minsky described.

### 4.2 Retrieval by surface words is brittle (Feasibility §3.2)

Storing K-lines was easy. Finding the right one was not. The development embedder is a
64-dimension bag-of-words model, and retrieval worked largely because agents were written
to emit matching vocabulary: the block-builder's success signal carries an explicit
description so it can be found later, and the censor registry converts tool names like
`move_block` into `move block` so the words overlap. A query punctuation issue
(`load-bearing` breaking the full-text parser) had to be fixed before retrieval was
reliable.

**Lesson:** an external memory indexed by descriptions is only as good as the words its
writers chose. Feasibility predicted that relevance needs judgment, not just matching.
Retrieval by similarity of internal state, rather than of text, would avoid this problem
entirely.

### 4.3 Failure learning needs real failures (Feasibility §5.4)

The censor mechanism works as built. A tool intent that matches a stored censor fires a
warning before the action, and its causal chain is recorded. But the demo censor was
installed by hand to represent a past failure. The full loop, where the system fails,
captures a censor from that failure and avoids the failure next time, was never run
end to end. How well censors generalize, and whether they block too much, remain
untested.

**Lesson:** censors are one of the places where an explicit, external rule is an
advantage, because it can be read and audited. They are a strong candidate for the
external layer even if memory moves inside the model.

### 4.4 Frames were designed, not learned (Feasibility §5.3, §7.4)

Frames, inheritance, trans-frames and frame-arrays all work. Every frame was written by
hand, and learning frames from many similar K-lines was not attempted. A language model
has already absorbed a great many such default structures from its training, which
suggests frames may be better *found* inside a model than *engineered* outside it.

### 4.5 Forgetting is partly built (Feasibility §3.2)

Temporal decay by band is implemented: fringe details fade in weeks, core activations
persist. Consolidation (merging similar K-lines, pruning unused ones, detecting
contradictions) was not built. With demo-scale memory it was never needed, so the
"hoarding" problem Feasibility described was never encountered.

### 4.6 Observability was the clearest success (Feasibility §6.4, §8.4)

Building the event log and introspection app first was the right call. Any outcome can be
traced back to the event that started it. The B-Brain observer detects loops, error
bursts, conflict spirals and stalls while never acting in the working society. This kept
the "no central controller" principle honest and made every other component debuggable.

**Lesson:** this is the strongest argument for keeping an external layer. Any move toward
internal memory would need an equivalent way to see what was re-activated and why.

### 4.7 Mapping every component to a Minsky concept helped

Requiring each component to correspond to a specific concept in the book kept the design
coherent and stopped it drifting toward a conventional orchestration framework. It also
produced a precise vocabulary for agent coordination, and it is what led to the central
finding: reading Minsky closely is what showed that K-lines are about re-creating states,
not storing records.

---

## 5. Scorecard Against the Feasibility Questions

| Feasibility question | Status | Notes |
|---|---|---|
| §7.1 What does the society add to reasoning agents? | Untested | Requires LLM agents |
| §7.2 What does long-term memory need? | Partly answered | Capture and retrieval work; retrieval depends on vocabulary; reactivation and consolidation not built; memory may belong inside the model |
| §7.3 Does failure learning work? | Partly answered | Censors fire correctly; the learn-from-real-failure loop was not run |
| §7.4 Do frames emerge or must they be designed? | Untested | All frames hand-designed |
| §7.5 Does the society dynamic emerge? | Not with coded agents | Demos ran as pipelines; conflicts only via test injection |
| §7.6 What is the minimum viable society? | Untested | |
| §7.7 Does the society get cheaper as it matures? | Untested | No LLM calls, so no cost data |

---

## 6. If Someone Picks This Up

There are two directions, and they are complementary.

**Continue the external society.** The codebase is a sound foundation for the experiment
that was not run:

1. Close the reactivation loop: when a K-line is retrieved, wake the agents it names,
   weighted by band.
2. Replace the demo agents with LLM agents one at a time, starting with the
   conversational society, and track tokens with the existing `agent.cost` signals.
3. Give agents different priorities, not just different knowledge, so that real
   conflicts reach the cross-exclusion and noncompromise mechanisms.
4. Run on a real, recurring use case over weeks, as Feasibility §8.3 recommends, and
   measure whether behavior and cost improve.

**Move memory inside the model.** Explore whether a K-line can be a stored pattern of a
model's internal activity, captured when a problem is solved and restored when a similar
one appears. Keep the external layer for what must stay visible: the causal log, the
B-Brain, and censors.

The theory Minsky wrote forty years ago is still the most complete account we have of how
many limited parts might add up to a mind. This project built that theory from the
outside and found its most important idea. The next test is whether that idea works
better from the inside.
