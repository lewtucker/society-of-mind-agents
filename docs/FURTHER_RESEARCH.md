---
title: Suggestions for Further Research and Development
version: 1.0
date: 2026-04-03
author: Lew Tucker
status: living
---

# Suggestions for Further Research and Development

The current system implements the full theoretical foundation of Minsky's Society of Mind
with a working demonstration. What follows are directions for extending it — from
near-term engineering improvements to open research questions.

---

## Near-Term: Activating the Full Architecture

These are straightforward extensions of what is already built, requiring no new
architectural decisions.

### 1. LLM-Backed Agents

All current agents use deterministic handlers — simple functions that simulate what an
LLM would do. The `Agent` class already supports LLM-backed operation via
`capability: "haiku" | "sonnet" | "opus"` and a `systemPrompt`. Swapping in real LLM
calls is a single-line change per agent.

**The interesting part**: the system's memory, conflict resolution, censor guards, and
B-Brain monitoring all work identically whether agents are deterministic or LLM-backed.
The architecture is substrate-agnostic. LLM agents will produce richer, more varied
signal payloads — which will in turn produce richer K-lines and more interesting
retrieval results.

**Suggested first experiment**: Replace `createResponseAgent()` in the conversational
society with a real Haiku-backed agent. Give it a system prompt that says: "You are a
conversational agent. You have been provided with retrieved memories from past
conversations. Use them to inform your response." Pass the retrieved K-line descriptions
in the message context. Observe whether the response quality improves across sessions
as more K-lines accumulate.

**What to measure**: Response quality before vs. after 10 conversation turns on the
same topic. Do the retrieved K-lines improve relevance? Does the retrieval score
distribution shift as the K-line store fills up?

### 2. ACT Mode and Real Tool Execution

The system has a full OBSERVE/ACT mode design (documented in `OBSERVE_AND_CONTROL.md`)
but only OBSERVE mode is implemented. ACT mode would:

- Parse `tool_intent` signals for tool name, arguments, and tier classification
- Auto-execute `auto_allow` tier tools immediately
- Queue `requires_approval` tier tools for human confirmation
- Permanently block `deny` tier tools regardless of agent intent

**The interesting part**: connecting a real tool library (file operations, web search,
code execution, API calls) to the polyneme bus. Agents emit `tool_intent` signals;
the ACT mode handler decides whether to execute. The censor registry already fires on
`tool_intent` signals — so failure learning is already wired to the execution path.

**Suggested implementation path**: Start with a single `auto_allow` tool (read a file,
fetch a URL). Wire it through the bus as a `tool_intent` → `tool.result` sequence.
Observe the K-line capture from `tool.result` — what does the system learn from a
successful tool use?

### 3. Persistent Event Log and Multi-Session Accumulation

The demos use in-memory SQLite that resets between test runs. The emit-test script
writes to `~/.som/events.db`, but the demos do not. Connecting the demo societies
to a persistent database would let K-lines accumulate across sessions — the longer the
system runs, the more it remembers.

**Suggested experiment**: Run the block-builder demo 10 times against a persistent
database. Plot the retrieval scores on each run. Does the top K-line score increase
as the store fills with similar K-lines? Does the system converge on a stable
"best K-line" for the block-stacking task?

This is a direct empirical test of Minsky's claim that K-lines improve behavior over time.

### 4. Real Embedding Vectors

The system uses a deterministic 64-dimensional BagOfWords embedder for development.
The `OpenAIEmbedder` class (1536-dimensional) is already implemented and just needs
an `OPENAI_API_KEY`. Real embeddings would produce richer similarity scores for
K-line retrieval, particularly for the conversational society where topic similarity
is nuanced.

**Alternative**: Implement a local embedding model using the `@xenova/transformers`
library (runs in Node.js, no API key, ~80MB model download). This would give
high-quality embeddings with zero external dependency — a better fit for the
system's self-contained design.

---

## Medium-Term: New Demo Societies

The most revealing way to validate the architecture is to apply it to different domains.
Each new society tests whether the memory and conflict mechanisms generalize.

### 5. Code Review Society

A society that reviews pull requests, accumulates K-lines about common issues, and
improves its review quality over time.

**Agents**:
- `StyleAgent` — checks formatting, naming conventions, import order
- `LogicAgent` — identifies potential bugs, off-by-one errors, null dereferences
- `SecurityAgent` — flags known insecure patterns (SQL injection, hardcoded secrets)
- `ContextAgent` — retrieves K-lines about prior issues in the same file/module
- `ReviewAgent` — synthesizes agent outputs into a coherent review comment

**What the memory layer adds**: After seeing 50 reviews, the system knows that this
codebase tends to forget null checks in database callbacks, tends to use `var` in
new files, and tends to hardcode environment variables. These patterns are encoded
as K-lines and activate on similar code.

**Censor opportunity**: When SecurityAgent detects a SQL injection pattern and the
PR is rejected, a censor K-line is written. Future PRs with similar patterns trigger
the censor before the review is even generated — the system pre-flags the issue.

### 6. Research Assistant Society

A society that reads papers, builds K-line memories of key findings, and synthesizes
across papers on related topics.

**Agents**:
- `AbstractAgent` — extracts the paper's contribution claim
- `MethodAgent` — identifies the methodology and experimental design
- `ResultAgent` — extracts key results and effect sizes
- `ContextAgent` — retrieves K-lines from related papers
- `SynthesisAgent` — identifies agreements, contradictions, and open questions

**What the memory layer adds**: The second paper on a topic retrieves K-lines from
the first. The synthesis is informed by accumulated prior reading, not just the
current paper. Over time, the system builds a coherent knowledge-tree of a research
area — with the K-line level-bands separating core claims (core band) from
methodological details (peripheral) from specific experimental conditions (fringe).

**Frame opportunity**: A `ResearchPaper` frame with terminals for contribution,
method, dataset, results, and limitations. New papers fill the slots; empty slots
use frame defaults ("results not yet replicated", "dataset unknown").

### 7. Customer Support Society

A society that handles support tickets, accumulates K-lines about resolution patterns,
and improves resolution time over hundreds of tickets.

**Agents**:
- `ClassifierAgent` — categorizes ticket by type (billing, technical, feature request)
- `DiagnosticAgent` — identifies symptoms and likely root causes
- `SolutionAgent` — proposes resolution steps
- `EscalationAgent` — determines whether the ticket needs human review
- `MemoryCaptureAgent` — captures resolved tickets as K-lines

**What the memory layer adds**: After 100 resolved tickets, the system recognizes
patterns: "authentication failure after password reset → clear browser cache" is
a K-line that activates whenever a similar ticket arrives, reducing diagnostic time.
Censors encode known bad resolutions: "telling users to reinstall the app for
billing issues wastes their time and escalates tickets."

**B-Brain opportunity**: The B-Brain detects when the same ticket type is recurring
at unusually high frequency — a signal that a new bug or policy change is causing
a spike. This is the kind of anomaly the B-Brain is designed to notice.

### 8. Learning and Tutoring Society

A society that teaches a subject, tracks student understanding via K-lines, and
adapts its explanations based on what has and has not worked.

**Agents**:
- `AssessmentAgent` — evaluates student responses against expected understanding
- `ExplanationAgent` — generates explanations at the appropriate level
- `AnalogAgent` — finds analogies from K-lines about similar concepts the student understands
- `MisconceptionAgent` — detects common misconceptions from censor K-lines
- `PaceAgent` — adjusts difficulty based on response quality trend

**What the memory layer adds**: After 20 sessions with a student, the system knows
that this student understands recursion but struggles with dynamic programming,
learns best from code examples rather than prose, and needs three attempts before
a new concept lands. These are K-line activation patterns, not structured profiles.

---

## Research Directions

### 9. K-Line Consolidation and Forgetting

Minsky described how K-lines should consolidate over time — similar K-lines merging
into more abstract K-lines, specific episode memories giving way to pattern memories.
This is not yet implemented.

**The open question**: What is the right consolidation policy? Options:
- **Temporal**: K-lines older than N days that are retrieved frequently → merge
- **Similarity-based**: K-lines with cosine similarity > 0.9 → merge into a parent K-line
- **Success-weighted**: K-lines with high retrieval count + associated with successful
  outcomes → promote to core band, lower-scoring ones → demote to fringe → expire

**Related to neuroscience**: This maps to the hippocampal-neocortical consolidation
model (McClelland et al., 1995) — episodic memories in the hippocampus consolidate
to semantic memories in the neocortex. The K-line system would mirror this: episode
K-lines (specific task runs) consolidate to pattern K-lines (general strategies).

### 10. Cross-Society Communication and Paranomes

Minsky described paranomes — mappings between realms that allow analogical reasoning.
"Building a tower" and "constructing an argument" share structural parallels: both
have a foundation, intermediate steps, and a capstone; both can collapse if the
foundation is weak; both require choosing components that fit together.

**The research question**: Can a society trained on block stacking retrieve K-lines
from a separate argument-construction society via cross-realm paranome mappings?
This would require:
- A shared paranome vocabulary (foundation = premise, step = support, capstone = conclusion)
- A cross-society retrieval path that searches both K-line stores
- Evidence that the retrieved K-lines actually improve performance in the new realm

This is a test of whether the architecture supports genuine analogy — not just
pattern-matching within a domain, but transfer between structurally similar domains.

### 11. Conflict as a Learning Signal

The current conflict resolver (cross-exclusion + noncompromise) suppresses agents in
conflict but does not learn from the conflict. When two agents repeatedly conflict on
the same terminal, the noncompromise path suppresses both — but no K-line is captured
from the resolution.

**The research question**: Should conflict be a learning signal? When noncompromise
fires, what K-line should be captured? Options:
- A censor K-line: "when agents A and B conflict on terminal T, suppress both"
- A positive K-line: "when conflict on terminal T resolved via agent C, the outcome was successful"
- A meta-K-line: "this class of task reliably produces agent-A/agent-B conflict; recruit
  a different agent for this terminal"

This connects to the broader question of how the society learns its own structure —
not just what to do in a given situation, but how to organize agents to handle
a given type of problem.

### 12. Frame Learning from Experience

Frames currently have fixed terminals defined at write time. The `switchPerspective()`
function carries shared terminal values across frames in an array, but terminals
themselves are not created or modified by experience.

**The research question**: Can frames learn from K-lines? Specifically:
- Can a new terminal be added to a frame because it was consistently present in K-lines
  associated with successful runs?
- Can a terminal's default value be updated toward the values found in high-scoring
  positive K-lines?
- Can a frame's parent be changed based on retrieval evidence?

This would make the frame system adaptive — the knowledge templates the society uses
would evolve to reflect actual experience rather than just designer intent.

### 13. Multi-Scale B-Brain Hierarchy

The current B-Brain is a single agent watching the entire society. Minsky's actual
B-Brain model is recursive: a B-Brain has its own B-Brain, which has its own B-Brain,
and so on. Each level observes the level below and operates at a coarser time scale.

**The research question**: What anomalies are visible only to a B-Brain operating
at a longer time scale? The current B-Brain detects loops within a 5-second window.
A level-2 B-Brain operating over hours would detect:
- Systematic avoidance of certain signal types (the society has learned to route around a broken agent)
- Slow drift in retrieval score distributions (K-line quality is changing)
- Correlated failure patterns across nominally independent tasks (two tasks that appear
  unrelated are both failing because they share a frame with a wrong default)

### 14. Distributed Agencies

The current system runs all agents in a single Node.js process on a single bus.
Minsky's theory does not require co-location — a society's agents could run on
different machines, with the polyneme bus as a distributed message broker.

**The implementation question**: Replace the in-memory bus with a distributed broker
(Redis Streams, NATS, or Kafka). Agents become independent processes or services.
The K-line store and frame store remain shared (or replicated with eventual consistency).

**The interesting research question**: Do distributed agencies produce different
emergent behavior than co-located ones? Network latency introduces real asynchrony
between agents — signals arrive at different times on different nodes. Does the
system's behavior degrade gracefully, or do causal chains break?

### 15. Training for a Specific Domain via K-Line Pre-Population

Rather than starting with an empty K-line store, pre-populate it with expert-curated
K-lines for a specific domain. This is the Society of Mind equivalent of fine-tuning:
instead of adjusting model weights, you install a curated episodic memory that shapes
which agents activate and in what configuration.

**Suggested experiment**: For the code review society, write 50 expert K-lines encoding
common review patterns: "secure database queries use parameterized statements",
"exported functions should have JSDoc type annotations", "async functions should handle
rejection". Measure whether the pre-populated society produces better reviews on the
first day than a cold-started society, and whether it continues to improve as it
accumulates its own K-lines.

**The deeper question**: What is the right abstraction for expressing expert K-lines?
They need to be in the same format as experience-derived K-lines (level-bands, situation
description, agent activations) but written by a human who knows the domain. This is a
knowledge engineering problem with a modern twist: the knowledge is encoded not as rules
but as activation patterns.

---

## Long-Term: Open Questions

### Does the Society Produce Genuine Emergence?

The central theoretical claim is that the society's behavior exceeds what any individual
agent achieves alone — and improves over time. The demos show this working in
controlled, small-scale scenarios. The open question is whether it scales:

- Does a society with 50 agents produce qualitatively different behavior than one with 5?
- Does a K-line store with 10,000 entries produce better retrieval than one with 100?
- Is there a "phase transition" where accumulated K-lines produce qualitatively new
  capabilities — analogical reasoning, creative recombination, metacognitive adjustment?

### What Is the Right Granularity for K-Lines?

The current system captures one K-line per `task.succeeded`. Too few K-lines means
the system has limited retrieval precision. Too many means the store fills with
redundant memories and retrieval degrades.

Should K-lines be captured at sub-task boundaries (each block placement) or only at
task completion? Should every `agent.cost` signal trigger a micro-K-line? Is there a
minimum meaningful episode that warrants K-line capture?

This is not just an engineering question — it connects to theories of episodic memory
granularity in cognitive science.

### Can the System Reason About Its Own Architecture?

The B-Brain observes the A-Brain. But can the B-Brain reason about the A-Brain's
*structure* — suggesting new agent subscriptions, retiring agents that are never
activated, recommending frame changes based on slot-filling success rates?

This would make the system reflexive in the deep sense Minsky described: a society that
can improve its own organization based on experience. It is the closest analog to
metalearning in the Society of Mind framework.

---

## Recommended Reading for Further Exploration

- Minsky, M. (2006). *The Emotion Machine*. Simon & Schuster. Minsky's sequel to
  The Society of Mind — extends the theory to emotions, self-models, and consciousness.
  More directly relevant to the B-Brain hierarchy and recursive self-observation.

- McClelland, J.L., McNaughton, B.L., & O'Reilly, R.C. (1995). "Why there are
  complementary learning systems in the hippocampus and neocortex." *Psychological
  Review*, 102(3). The neuroscience basis for K-line consolidation (hippocampal
  episodic → neocortical semantic).

- Tulving, E. (2002). "Episodic memory: From mind to brain." *Annual Review of
  Psychology*, 53, 1–25. The definitive account of episodic memory, directly
  mapped by K-lines.

- Lake, B.M. et al. (2017). "Building machines that learn and think like people."
  *Behavioral and Brain Sciences*, 40. Argues that human-like AI requires compositional
  representations (frames), causal models (difference-engines), and model-based
  reasoning (K-line retrieval) — a strong independent argument for this architecture.

- Botvinick, M. et al. (2019). "Reinforcement learning, fast and slow." *Trends in
  Cognitive Sciences*, 23(5). The episodic vs. semantic distinction in RL —
  episodic memory enables fast one-shot learning; semantic memory enables
  generalization. K-lines are the Society of Mind's implementation of this distinction.
