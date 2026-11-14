// ─── Frames table ─────────────────────────────────────────────────────────────

export const CREATE_META_TABLE = `
  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )
`;

export const SET_SCHEMA_VERSION = `
  INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '2')
`;

export const CREATE_FRAMES_TABLE = `
  CREATE TABLE IF NOT EXISTS frames (
    id              TEXT    PRIMARY KEY,
    name            TEXT    NOT NULL UNIQUE,
    description     TEXT    NOT NULL DEFAULT '',
    terminals       TEXT    NOT NULL DEFAULT '{}',
    parent_frame_id TEXT    REFERENCES frames(id),
    frame_type      TEXT    NOT NULL DEFAULT 'standard',
    roles           TEXT    DEFAULT NULL,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
  )
`;

// ─── FTS index ────────────────────────────────────────────────────────────────

export const CREATE_FRAMES_FTS = `
  CREATE VIRTUAL TABLE IF NOT EXISTS frames_fts USING fts5(
    frame_id   UNINDEXED,
    name,
    description,
    tokenize = 'porter unicode61'
  )
`;

// ─── Frame-arrays table ───────────────────────────────────────────────────────

/**
 * A frame-array is a named set of frames that share terminal vocabulary.
 * frame_ids is stored as a JSON array of ULIDs (ordered).
 */
export const CREATE_FRAME_ARRAYS_TABLE = `
  CREATE TABLE IF NOT EXISTS frame_arrays (
    id         TEXT    PRIMARY KEY,
    name       TEXT    NOT NULL UNIQUE,
    frame_ids  TEXT    NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )
`;

// ─── Indexes ──────────────────────────────────────────────────────────────────

export const CREATE_INDEXES = `
  CREATE INDEX IF NOT EXISTS idx_frames_name      ON frames(name);
  CREATE INDEX IF NOT EXISTS idx_frames_parent    ON frames(parent_frame_id);
  CREATE INDEX IF NOT EXISTS idx_frame_arrays_name ON frame_arrays(name)
`;
