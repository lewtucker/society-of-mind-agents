export const CREATE_GOALS_TABLE = `
  CREATE TABLE IF NOT EXISTS goals (
    id          TEXT    PRIMARY KEY,
    description TEXT    NOT NULL DEFAULT '',
    frame_id    TEXT    DEFAULT NULL,
    desired     TEXT    NOT NULL DEFAULT '{}',
    active      INTEGER NOT NULL DEFAULT 1,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  )
`;

export const CREATE_GOALS_INDEXES = `
  CREATE INDEX IF NOT EXISTS idx_goals_active ON goals(active)
`;
