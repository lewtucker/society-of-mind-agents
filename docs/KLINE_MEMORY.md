---
title: "K-Line Memory Subarchitecture"
version: "1.0"
date: 2026-04-01
author: Lew Tucker
status: Draft
document-id: SOM-KLINE
changelog:
  - version: "1.0"
    date: 2026-04-01
    summary: Initial draft — K-line schema, storage, retrieval, and consolidation design
---

# K-Line Memory Subarchitecture

This document specifies the memory subsystem for the Society of Mind agentic system — the concrete implementation of Minsky's K-line theory. It draws on the openclaw memory implementation (see `~/Documents/dev/openclaw clone`) as a reference for proven patterns and departs from it where K-line semantics require something richer.

---

## 1. What a K-Line Is (and Isn't)

Minsky: *"A K-line is a mental state — a record of which agents were active when something worked."*

**Not** a text chunk. **Not** a summary of what happened. A K-line is a structured activation snapshot: which agents were firing, in what frame, with what pronome bindings, and in what context. When retrieved, it does not just inform the system — it *reconstitutes a similar mental state* by reactivating the recorded agents.

### K-line types

| Type | Minsky concept | When created | What it records |
|---|---|---|---|
| **Positive** | K-line | Task succeeds | Agent activations, frame, pronomes, context |
| **Censor** | Censor memory | Precursor to bad outcome detected | Precursor pattern + blocked action |
| **Suppressor** | Suppressor memory | Bad outcome actually occurred | Pre-state + bad action + bad outcome |
| **Abstract** | K-society / knowledge-tree | Consolidation pass | Common structure across multiple K-lines |

---

## 2. Data Models

### 2.1 Core K-line record

```typescript
interface KLine {
  // Identity
  id: string;                    // ULID (time-ordered, globally unique)
  type: "positive" | "censor" | "suppressor" | "abstract";
  created_at: number;            // Unix ms
  updated_at: number;

  // Situation (what was happening when this K-line was created)
  situation: {
    description: string;         // Human-readable summary — this is what gets embedded
    frame_id: string | null;     // Active frame at capture time
    pronomes: Record<string, string>;  // Role bindings: { Actor, Goal, Object, ... }
    micronemes: number[];        // Context embedding vector (1536-dim)
    realm: string[];             // Active realms: ["physical", "social", "temporal"]
  };

  // Activation snapshot (the K-line proper — which agents were active)
  activations: AgentActivation[];

  // Level-banding (confidence weights — the core of K-line theory)
  bands: {
    core: LevelBand;             // High confidence, persists indefinitely
    peripheral: LevelBand;       // Moderate confidence, decays slowly
    fringe: LevelBand;           // Weak defaults, decays fast, easily overridden
  };

  // For censor/suppressor types only
  guard?: {
    precursor_pattern: string;   // What to watch for (natural language description)
    blocked_action: string;      // What to prevent
    outcome_description: string; // Why it was bad (suppressor) or why it would be bad (censor)
  };

  // Hierarchy (knowledge-trees)
  parent_id: string | null;      // Abstract K-line this generalizes from, if any
  child_ids: string[];           // More specific K-lines this abstracts over

  // Provenance
  source_events: string[];       // EventLog IDs from the polyneme bus audit trail
  task_id: string | null;        // The task whose success/failure triggered capture
  retrieval_count: number;       // How often this K-line has been retrieved
  last_retrieved_at: number | null;

  // Embedding (for similarity retrieval)
  embedding: number[];           // Float32 vector of situation.description
  embedding_model: string;       // e.g., "text-embedding-3-small"
  embedding_hash: string;        // SHA-256 of situation.description (for cache dedup)
}

interface AgentActivation {
  agent_id: string;
  agent_type: string;            // e.g., "MemoryManager", "FrameSelector", "Builder"
  role: string | null;           // Pronome role this agent filled, if any
  band: "core" | "peripheral" | "fringe";
  confidence: number;            // 0-1: how important was this agent to the outcome?
  signal_ids: string[];          // Polyneme bus event IDs emitted by this agent
}

interface LevelBand {
  agents: string[];              // Agent IDs in this band
  properties: Record<string, { value: unknown; confidence: number; }>;
  decay_rate: number;            // Half-life in days (fringe: 30, peripheral: 180, core: never)
}
```

### 2.2 Censor record (failure learning)

```typescript
// Stored as KLine with type="censor" or "suppressor", plus the guard field populated.
// Censors and suppressors are retrieved differently from positive K-lines:
// - Positive K-lines: retrieved by SIMILARITY to current situation (find the closest match)
// - Censor K-lines: retrieved by PRECURSOR DETECTION (check if situation matches "watch for" pattern)
//
// In practice: every situation evaluation runs TWO queries:
//   1. similarity search → what worked before?
//   2. censor check → is anything currently blocked?
```

### 2.3 SQLite schema

```sql
-- Core K-line records (structured data + embeddings)
CREATE TABLE klines (
  id              TEXT PRIMARY KEY,          -- ULID
  type            TEXT NOT NULL,             -- positive | censor | suppressor | abstract
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  situation_desc  TEXT NOT NULL,             -- Embeddable description
  frame_id        TEXT,
  pronomes        TEXT NOT NULL,             -- JSON
  realm           TEXT NOT NULL,             -- JSON array
  activations     TEXT NOT NULL,             -- JSON array of AgentActivation
  bands           TEXT NOT NULL,             -- JSON: { core, peripheral, fringe }
  guard           TEXT,                      -- JSON, null for positive K-lines
  parent_id       TEXT,
  child_ids       TEXT NOT NULL DEFAULT '[]',
  source_events   TEXT NOT NULL DEFAULT '[]',
  task_id         TEXT,
  retrieval_count INTEGER NOT NULL DEFAULT 0,
  last_retrieved  INTEGER,
  embedding       BLOB NOT NULL,             -- Float32 array (stored as BLOB)
  embedding_model TEXT NOT NULL,
  embedding_hash  TEXT NOT NULL
);

-- Vector table (sqlite-vec) for cosine similarity search
CREATE VIRTUAL TABLE klines_vec USING vec0(
  id TEXT PRIMARY KEY,
  embedding FLOAT[1536]
);

-- Full-text search index (for censor precursor matching + keyword fallback)
CREATE VIRTUAL TABLE klines_fts USING fts5(
  id UNINDEXED,
  situation_desc,
  guard_precursor,
  tokenize = 'porter unicode61'
);

-- Embedding cache (same pattern as openclaw — hash-based dedup per model)
CREATE TABLE embedding_cache (
  hash            TEXT NOT NULL,
  model           TEXT NOT NULL,
  embedding       BLOB NOT NULL,
  updated_at      INTEGER NOT NULL,
  PRIMARY KEY (hash, model)
);

-- Retrieval log (for reinforcement — frequently retrieved K-lines grow stronger)
CREATE TABLE retrieval_log (
  id              TEXT PRIMARY KEY,          -- ULID
  kline_id        TEXT NOT NULL,
  retrieved_at    INTEGER NOT NULL,
  query_desc      TEXT NOT NULL,
  similarity_score REAL NOT NULL,
  was_used        INTEGER NOT NULL DEFAULT 0  -- 1 if this K-line influenced an outcome
);

-- Metadata
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

---

## 3. Capture Workflow

K-lines are created by the **MemoryManager agency** at two moments:

1. **Task success**: Polyneme bus emits a `task.succeeded` signal. MemoryManager reads the event subsequence from the audit log and creates a positive K-line.
2. **Failure detection**: A Suppressor fires after a bad outcome, or a Censor recognizes a precursor. MemoryManager creates a censor/suppressor K-line.

### 3.1 Positive K-line capture

```
ON task.succeeded event:
  1. EXTRACT event subsequence
     - Walk audit log from task_start to task_succeeded
     - Collect all event IDs in the causal chain (via causedBy links)
     - Identify active agents: any agent that emitted at least one event

  2. CLASSIFY activations by band
     - Core: agents that emitted events on the critical path (direct causedBy chain)
     - Peripheral: agents that contributed but weren't on critical path
     - Fringe: agents that were activated but whose signals weren't referenced

  3. BUILD situation description
     - Ask a dedicated SituationDescriber agent (LLM-backed) to write a
       1-2 sentence description of "what situation was present when this worked"
     - Include: frame type, pronome roles, realm, any distinctive features
     - This text is what gets embedded — quality matters

  4. EMBED situation description
     - Check embedding_cache by SHA-256(description + model)
     - If cache miss: call embedding provider (OpenAI text-embedding-3-small default)
     - Store in embedding_cache

  5. ASSIGN level-band confidences
     - Core agents: confidence = 1.0
     - Peripheral agents: confidence from (signal_count / max_signal_count) * 0.8
     - Fringe agents: confidence = 0.2 + random jitter (default, easily displaced)

  6. WRITE to DB
     - Insert into klines table
     - Upsert into klines_vec (for similarity search)
     - Upsert into klines_fts (situation_desc field)
```

### 3.2 Censor/Suppressor capture

```
ON failure.detected or bad_outcome.occurred:
  1. IDENTIFY the precursor pattern
     - For suppressors: extract the state that existed just BEFORE the bad action
     - For censors: the precursor state is already known (it triggered the censor)

  2. ASK a CensorDescriber agent to write:
     - precursor_pattern: "When X is happening and Y is the goal and Z is the context..."
     - blocked_action: "...do NOT do [action]..."
     - outcome_description: "...because [what goes wrong]"

  3. EMBED the precursor_pattern (not the situation description — censors are retrieved
     by matching the current situation to the precursor, not to each other)

  4. WRITE to DB with type = "censor" or "suppressor"
     - Upsert into klines_fts with guard_precursor field populated
```

---

## 4. Retrieval Workflow

Every situation evaluation runs **two parallel queries**:

### 4.1 Positive retrieval (what worked before?)

Mirrors openclaw's hybrid search. Same proven pattern: vector + FTS, merge, decay, MMR.

```
INPUT: current_situation_description (string), current_frame_id, current_pronomes, top_k

1. EMBED the situation description
   - Check embedding_cache by hash
   - If miss: call embedding provider

2. VECTOR SEARCH (70% weight)
   SELECT id, vec_distance_cosine(embedding, ?) AS distance
   FROM klines_vec
   WHERE type = 'positive' OR type = 'abstract'
   ORDER BY distance ASC
   LIMIT top_k * 3   -- oversample for hybrid merge

3. FTS SEARCH (30% weight)
   SELECT id, bm25(klines_fts) AS rank
   FROM klines_fts
   WHERE situation_desc MATCH ?
     AND (type = 'positive' OR type = 'abstract')
   ORDER BY rank
   LIMIT top_k * 3

4. HYBRID MERGE
   - Merge by id, keeping max score per K-line
   - vector_score = 1 - cosine_distance
   - fts_score = 1 / (1 + abs(bm25_rank))
   - combined = 0.7 * vector_score + 0.3 * fts_score

5. TEMPORAL DECAY (same formula as openclaw)
   - score *= exp(-ln(2) / half_life_days * age_in_days)
   - Core K-lines: half_life = infinity (no decay)
   - Peripheral K-lines: half_life = 180 days
   - Fringe K-lines: half_life = 30 days
   - Abstract K-lines: no decay (earned stability)

6. MMR RE-RANKING
   - Greedy selection maximizing: 0.7 * relevance - 0.3 * max_similarity_to_selected
   - Similarity metric: Jaccard on situation description tokens
   - Prevents surfacing three nearly-identical K-lines

7. FILTER by min_score (default 0.35)
   RETURN top_k results with full KLine objects
```

### 4.2 Censor check (what's blocked right now?)

Run in parallel with positive retrieval. Operates on the `guard_precursor` FTS index.

```
INPUT: current_situation_description

1. KEYWORD EXTRACTION
   - Extract key nouns/verbs from situation description (same as openclaw's extractKeywords)
   - Build FTS query from keywords

2. FTS SEARCH on censor K-lines only
   SELECT id, bm25(klines_fts) AS rank
   FROM klines_fts
   WHERE guard_precursor MATCH ?
     AND (type = 'censor' OR type = 'suppressor')
   ORDER BY rank
   LIMIT 20

3. SECONDARY LLM FILTER
   - For each candidate censor, ask a CensorEvaluator agent (LLM-backed):
     "Does the current situation [description] match this precursor pattern: [precursor]?"
   - Binary yes/no with confidence
   - Keep censors where confidence > 0.7

4. RETURN active censors
   - These block specific actions in the current situation
   - The ConflictResolver and DifferenceEngine must check these before activating any agent
```

### 4.3 Output: the memory context bundle

```typescript
interface MemoryContextBundle {
  positive_klines: KLine[];       // Top-k positive matches, ranked
  active_censors: KLine[];        // Currently blocking guards
  suggested_agents: AgentActivation[];  // Union of core activations from top-3 K-lines
  confidence: number;             // Max similarity score from positive retrieval
  from_cold_start: boolean;       // True if no K-lines above threshold — system is learning
}
```

---

## 5. Level-Banding in Practice

Level-banding is what makes K-lines generalize rather than merely memorize.

### 5.1 Default filling at retrieval

When a K-line is retrieved and a situation has unknowns, fringe fields act as default assumptions:

```
Situation: "building a tower, target height unknown"
Retrieved K-line fringe: { target_height: { value: 3, confidence: 0.2 } }

→ System proceeds as if target_height = 3 (a weak default)
→ If the actual target_height arrives, it OVERRIDES the fringe default
→ If target_height never arrives, the fringe default persists for this task
```

### 5.2 Confidence evolution

Core fields never decay. Fringe fields decay and can be overridden. The mechanism is simple:

```
On K-line retrieval:
  - Increment retrieval_count
  - If this K-line influenced a SUCCESSFUL outcome: upgrade fringe agents to peripheral
  - If this K-line influenced a FAILED outcome: downgrade peripheral agents to fringe,
    flag for censor creation

On scheduled consolidation pass:
  - For each K-line not retrieved in 90 days: decay fringe confidence by 50%
  - For each K-line retrieved > 20 times: promote peripheral → core (earned)
```

---

## 6. Hierarchical K-Lines (Knowledge-Trees)

Abstract K-lines are created during consolidation when multiple specific K-lines share structure. They function as prototypes — less precise than specific K-lines but useful for cold-start situations.

### 6.1 Consolidation trigger

```
Scheduled daily:
  1. CLUSTER positive K-lines by embedding similarity (cosine > 0.85 threshold)
  2. For each cluster of size >= 3:
     a. Find common agents in core bands
     b. Find common pronome roles
     c. Find common frame_id (if same)
     d. Ask a ConsolidationAgent (LLM-backed):
        "These K-lines all succeeded in similar situations. Write an abstract description
         of the common situation and the common approach."
     e. Create an abstract K-line with:
        - type = "abstract"
        - activations = intersection of core agents from all cluster members
        - bands.core = agents common to ALL members
        - bands.fringe = agents common to SOME members (with averaged confidence)
        - child_ids = cluster member IDs
        - situation.description = abstract description from LLM
     f. Set parent_id on all cluster members to the new abstract K-line
```

### 6.2 Hierarchical retrieval

At retrieval time, abstract K-lines match broader situations. The retrieval result includes both abstract matches (fast recall of the general shape) and specific matches (detailed recall of exact episodes). The MemoryManager returns both:

```
Abstract K-lines → suggest which agents to try (general shape)
Specific K-lines → provide full pronome bindings, censor context, precise confidence
```

---

## 7. Storage Location and Initialization

Following openclaw's pattern of per-agent local storage:

```
~/.som/memory/
  klines.sqlite            ← main database
  embeddings.cache         ← shared embedding cache (all K-lines use one cache)
  meta.json                ← provider config, model name, vector dims
```

For multi-agent deployments, K-lines are shared across the society (not per-agent). This is a key departure from openclaw (which is per-agent): the society's memory is collective.

### 7.1 Manager initialization

```typescript
// Singleton per society instance
const memory = await KLineMemoryManager.init({
  db_path: "~/.som/memory/klines.sqlite",
  embedding_provider: "openai",
  embedding_model: "text-embedding-3-small",
  vector_dims: 1536,
  enable_sqlite_vec: true,      // accelerated cosine search
  enable_fts: true,             // full-text search for censors
  consolidation_schedule: "0 3 * * *"  // 3am daily
});
```

---

## 8. What openclaw Provides vs. What We Build

| Capability | openclaw | K-line system | Notes |
|---|---|---|---|
| Vector storage | sqlite-vec | ✓ same | Proven pattern, reuse directly |
| Hybrid search (vec + FTS) | ✓ 70/30 | ✓ same | Reuse the merge formula |
| Temporal decay | ✓ opt-in | ✓ per-band | Band-specific half-lives replace one global |
| MMR re-ranking | ✓ opt-in | ✓ same | Reuse from openclaw |
| Embedding cache | ✓ hash dedup | ✓ same | Same SHA-256 + model key |
| Embedding providers | OpenAI/Gemini/Voyage/local | ✓ same | Reuse provider abstraction |
| Chunking | Token-based markdown | N/A | K-lines are structured records, not text chunks |
| File watching | Chokidar | N/A | K-lines are created by events, not file changes |
| Memory source | Markdown files | Polyneme bus audit log | Fundamentally different source |
| Record type | Text chunk | Activation snapshot | The key structural difference |
| Level-banding | No | ✓ new | Core Minsky concept, no analog in openclaw |
| Censor retrieval | No | ✓ new | Parallel FTS + LLM filter pass |
| Hierarchical K-lines | No | ✓ new | Knowledge-tree via parent/child_ids |
| Consolidation agent | Memory flush (LLM) | ✓ extended | openclaw flushes to markdown; we abstract to new K-lines |

**Bottom line**: openclaw's storage engine (SQLite + sqlite-vec + FTS5), search pipeline (hybrid merge + decay + MMR), and embedding infrastructure (cache + batch + provider abstraction) are all directly reusable. What we add on top is the K-line-specific data model — activation snapshots, level-banding, censor guards, and hierarchical structure.

---

## 9. Build Order

1. **SQLite schema + migration tooling** — create all tables; can be tested in isolation
2. **Embedding pipeline** — provider abstraction + cache (openclaw reference implementation exists)
3. **KLineMemoryManager** — CRUD + vector upsert + FTS upsert
4. **Positive retrieval** — hybrid search + decay + MMR (adapt openclaw's merge formula directly)
5. **Positive capture** — SituationDescriber agent + band classification + write
6. **Censor check** — FTS precursor search + CensorEvaluator LLM filter
7. **Censor/suppressor capture** — CensorDescriber agent + write
8. **Level-band evolution** — confidence updates on retrieval outcome feedback
9. **Consolidation pass** — clustering + ConsolidationAgent + abstract K-line creation
10. **Hierarchical retrieval** — merge abstract + specific in result bundle

Steps 1-5 are the minimum viable K-line system. Steps 6-10 complete Minsky's vision.

---

## 10. Open Questions

These are not design gaps — they are the research questions this build is meant to answer (see FEASIBILITY.md §7):

1. **Cold start**: How many successful tasks before K-line retrieval beats bare LLM context? Measure at 10, 50, 100, 500 K-lines.
2. **Fringe half-life**: Is 30 days right? Too fast and useful defaults expire. Too slow and the system ossifies. Instrument and tune.
3. **Censor precision**: Do censors over-fire (false positive blocking) or under-fire (miss actual precursors)? Log all censor evaluations.
4. **Consolidation threshold**: Is cosine > 0.85 the right clustering threshold? Too tight and abstractions don't form. Too loose and abstractions are useless stereotypes.
5. **Situation description quality**: The embedding of `situation.description` is the whole retrieval bet. Does LLM-generated description quality dominate retrieval accuracy? Test alternatives: structured field hash vs. free text description.
