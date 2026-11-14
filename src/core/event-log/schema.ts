/**
 * SQLite schema for the append-only event log.
 *
 * Design notes:
 * - id is a ULID: lexicographically sortable by time, so ORDER BY id = ORDER BY time
 * - payload and context are stored as JSON text
 * - WAL mode is set at open time (see EventLog.ts), not here
 * - No UPDATE or DELETE ever runs against this table — append-only by convention
 */
export const CREATE_EVENTS_TABLE = `
  CREATE TABLE IF NOT EXISTS events (
    id         TEXT    NOT NULL PRIMARY KEY,
    timestamp  INTEGER NOT NULL,
    source     TEXT    NOT NULL,
    signal     TEXT    NOT NULL,
    type       TEXT    NOT NULL,
    payload    TEXT    NOT NULL DEFAULT '{}',
    context    TEXT    NOT NULL DEFAULT '{}',
    caused_by  TEXT
  );
`;

/**
 * Indexes to support the two query patterns we need:
 *   1. tail(): SELECT WHERE id > ? ORDER BY id  — covered by PK index
 *   2. recent(since): same
 *   3. Filter by source or signal type (introspection app filters)
 */
export const CREATE_INDEXES = `
  CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events (timestamp);
  CREATE INDEX IF NOT EXISTS idx_events_source    ON events (source);
  CREATE INDEX IF NOT EXISTS idx_events_signal    ON events (signal);
  CREATE INDEX IF NOT EXISTS idx_events_type      ON events (type);
`;

/**
 * Metadata table: stores schema version and society-wide config.
 */
export const CREATE_META_TABLE = `
  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT NOT NULL PRIMARY KEY,
    value TEXT NOT NULL
  );
`;

export const SCHEMA_VERSION = "1";

export const SET_SCHEMA_VERSION = `
  INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', '${SCHEMA_VERSION}');
`;
