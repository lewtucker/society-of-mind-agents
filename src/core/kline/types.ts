// ─── Primitives ───────────────────────────────────────────────────────────────

export type KLineType = "positive" | "censor" | "suppressor" | "abstract";
export type BandName  = "core" | "peripheral" | "fringe";

// ─── Sub-structures ───────────────────────────────────────────────────────────

/**
 * Records one agent's participation in a successful episode.
 * Band assignment determines how strongly this activation is recalled.
 */
export interface AgentActivation {
  agent_id:   string;
  agent_type: string;           // e.g. "FindAgent", "MemoryManager"
  role:       string | null;    // Pronome role this agent filled, if any
  band:       BandName;
  confidence: number;           // 0–1: how important was this agent to the outcome?
  signal_ids: string[];         // Polyneme bus event IDs emitted by this agent
}

/**
 * One confidence band in a K-line (core / peripheral / fringe).
 *
 * Level-banding is the heart of K-line theory: core agents are recalled
 * reliably and indefinitely; fringe agents serve as weak defaults that
 * decay over time and are easily displaced by better information.
 */
export interface LevelBand {
  agents:     string[];         // Agent IDs assigned to this band
  properties: Record<string, { value: unknown; confidence: number }>;
  decay_rate: number;           // Half-life in days (0 = never decays)
}

export interface KLineBands {
  core:       LevelBand;        // High confidence, no decay
  peripheral: LevelBand;        // Moderate confidence, slow decay (180d half-life)
  fringe:     LevelBand;        // Weak defaults, fast decay (30d half-life)
}

/**
 * What was happening when this K-line was created.
 * The `description` field is what gets embedded for similarity retrieval.
 */
export interface KLineSituation {
  description: string;          // Human-readable — embedded for vector search
  frame_id:    string | null;   // Active frame at capture time
  pronomes:    Record<string, string>;   // Role bindings at capture time
  micronemes:  number[];        // Context embedding vector
  realm:       string[];        // Active realms: ["physical", "social", …]
}

/** For censor/suppressor K-lines only. */
export interface KLineGuard {
  precursor_pattern:   string;  // What to watch for (natural language)
  blocked_action:      string;  // What to prevent
  outcome_description: string;  // Why it was bad
}

// ─── Core K-line record ───────────────────────────────────────────────────────

export interface KLine {
  // Identity
  id:         string;           // ULID
  type:       KLineType;
  created_at: number;           // Unix ms
  updated_at: number;

  // Situation
  situation: KLineSituation;

  // Activation snapshot
  activations: AgentActivation[];

  // Level-banding
  bands: KLineBands;

  // Failure learning (censor/suppressor only)
  guard: KLineGuard | null;

  // Hierarchy (knowledge-trees)
  parent_id: string | null;
  child_ids: string[];          // maintained automatically by KLineStore.write()

  // Provenance
  source_events:   string[];    // EventLog IDs from the polyneme bus
  task_id:         string | null;

  // Retrieval tracking
  retrieval_count:  number;
  last_retrieved:   number | null;

  // Embedding (populated in Phase 2.2 when embedding provider is wired)
  embedding:        number[];
  embedding_model:  string;
  embedding_hash:   string;
}

// ─── Input type (what callers provide when creating a K-line) ─────────────────

/**
 * Input for KLineStore.write() — auto-assigned fields are omitted.
 * Embedding fields are optional in Phase 2.1; they default to empty
 * and will be populated by the MemoryManager in Phase 2.2.
 */
export type KLineInput = Omit<KLine,
  | "id"
  | "created_at"
  | "updated_at"
  | "retrieval_count"
  | "last_retrieved"
  | "child_ids"        // auto-maintained via parent_id
> & {
  embedding?:       number[];
  embedding_model?: string;
  embedding_hash?:  string;
};

// ─── List options ─────────────────────────────────────────────────────────────

export interface KLineListOptions {
  type?:    KLineType | KLineType[];
  frameId?: string;
  taskId?:  string;
  limit?:   number;
  offset?:  number;
  orderBy?: "created_at" | "retrieval_count" | "last_retrieved";
  desc?:    boolean;
}

// ─── Default band factories ───────────────────────────────────────────────────

export function emptyBands(): KLineBands {
  return {
    core:       { agents: [], properties: {}, decay_rate: 0   },
    peripheral: { agents: [], properties: {}, decay_rate: 180 },
    fringe:     { agents: [], properties: {}, decay_rate: 30  },
  };
}
