// ─── KLine store DDL ─────────────────────────────────────────────────────────
//
// Phase 2.1: core tables + FTS5 index. No sqlite-vec yet — that's Phase 2.2.
// Embeddings are stored as JSON text; the vec0 virtual table is added in 2.2.

export const CREATE_META_TABLE = `
  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )
`;

export const SET_SCHEMA_VERSION = `
  INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '1')
`;

export const CREATE_KLINES_TABLE = `
  CREATE TABLE IF NOT EXISTS klines (
    id              TEXT    PRIMARY KEY,
    type            TEXT    NOT NULL,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,

    -- Situation
    situation_desc  TEXT    NOT NULL,
    frame_id        TEXT,
    pronomes        TEXT    NOT NULL DEFAULT '{}',
    realm           TEXT    NOT NULL DEFAULT '[]',
    micronemes      TEXT    NOT NULL DEFAULT '[]',

    -- Activation snapshot and level-banding (denormalized JSON)
    activations     TEXT    NOT NULL DEFAULT '[]',
    bands           TEXT    NOT NULL,

    -- Failure learning
    guard           TEXT,

    -- Hierarchy
    parent_id       TEXT,
    child_ids       TEXT    NOT NULL DEFAULT '[]',

    -- Provenance
    source_events   TEXT    NOT NULL DEFAULT '[]',
    task_id         TEXT,

    -- Retrieval tracking
    retrieval_count INTEGER NOT NULL DEFAULT 0,
    last_retrieved  INTEGER,

    -- Embedding (Phase 2.2: will be mirrored into klines_vec for cosine search)
    embedding       TEXT    NOT NULL DEFAULT '[]',
    embedding_model TEXT    NOT NULL DEFAULT 'none',
    embedding_hash  TEXT    NOT NULL DEFAULT ''
  )
`;

// FTS5 for keyword search on situation descriptions and censor precursor patterns
// (Porter stemmer + unicode61 tokenizer for multilingual support)
export const CREATE_FTS_TABLE = `
  CREATE VIRTUAL TABLE IF NOT EXISTS klines_fts USING fts5(
    kline_id       UNINDEXED,
    situation_desc,
    guard_precursor,
    tokenize = 'porter unicode61'
  )
`;

// Embedding cache — deduplicates API calls by SHA-256(text + model)
export const CREATE_EMBEDDING_CACHE = `
  CREATE TABLE IF NOT EXISTS embedding_cache (
    hash       TEXT    NOT NULL,
    model      TEXT    NOT NULL,
    embedding  TEXT    NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (hash, model)
  )
`;

// Retrieval log — feeds the reinforcement/investment-principle loop (Phase 2.2+)
export const CREATE_RETRIEVAL_LOG = `
  CREATE TABLE IF NOT EXISTS retrieval_log (
    id               TEXT    PRIMARY KEY,
    kline_id         TEXT    NOT NULL,
    retrieved_at     INTEGER NOT NULL,
    query_desc       TEXT    NOT NULL,
    similarity_score REAL    NOT NULL,
    was_used         INTEGER NOT NULL DEFAULT 0
  )
`;

export const CREATE_INDEXES = `
  CREATE INDEX IF NOT EXISTS idx_klines_type       ON klines (type);
  CREATE INDEX IF NOT EXISTS idx_klines_frame      ON klines (frame_id);
  CREATE INDEX IF NOT EXISTS idx_klines_parent     ON klines (parent_id);
  CREATE INDEX IF NOT EXISTS idx_klines_task       ON klines (task_id);
  CREATE INDEX IF NOT EXISTS idx_klines_created    ON klines (created_at);
  CREATE INDEX IF NOT EXISTS idx_retrieval_kline   ON retrieval_log (kline_id);
  CREATE INDEX IF NOT EXISTS idx_retrieval_time    ON retrieval_log (retrieved_at)
`;
