import Database from "better-sqlite3";
import { monotonicFactory } from "ulid";
import { CREATE_GOALS_INDEXES, CREATE_GOALS_TABLE } from "./schema.ts";
import type { Goal, GoalInput } from "./types.ts";

const ulid = monotonicFactory();

// ─── Raw DB row ───────────────────────────────────────────────────────────────

interface RawRow {
  id:          string;
  description: string;
  frame_id:    string | null;
  desired:     string;
  active:      number;   // SQLite stores booleans as 0/1
  created_at:  number;
  updated_at:  number;
}

function rowToGoal(row: RawRow): Goal {
  return {
    id:          row.id,
    description: row.description,
    frame_id:    row.frame_id,
    desired:     JSON.parse(row.desired) as Record<string, unknown>,
    active:      row.active !== 0,
    created_at:  row.created_at,
    updated_at:  row.updated_at,
  };
}

// ─── GoalStore ────────────────────────────────────────────────────────────────

/**
 * Persistent storage for Goals — the desired-state representations that drive
 * the difference-engine.
 *
 * Goals are written once and either achieved (setActive false) or abandoned.
 * The store is intentionally minimal — goal reasoning happens in the engine.
 */
export class GoalStore {
  private readonly db: Database.Database;

  private readonly insertStmt:    Database.Statement;
  private readonly getByIdStmt:   Database.Statement;
  private readonly setActiveStmt: Database.Statement;
  private readonly listStmt:      Database.Statement;
  private readonly listActiveStmt: Database.Statement;

  private constructor(db: Database.Database) {
    this.db = db;

    this.insertStmt = db.prepare(`
      INSERT INTO goals (id, description, frame_id, desired, active, created_at, updated_at)
      VALUES (@id, @description, @frame_id, @desired, 1, @created_at, @updated_at)
    `);

    this.getByIdStmt = db.prepare(`SELECT * FROM goals WHERE id = @id`);

    this.setActiveStmt = db.prepare(`
      UPDATE goals SET active = @active, updated_at = @updated_at WHERE id = @id
    `);

    this.listStmt = db.prepare(`
      SELECT * FROM goals ORDER BY created_at DESC LIMIT @limit OFFSET @offset
    `);

    this.listActiveStmt = db.prepare(`
      SELECT * FROM goals WHERE active = 1 ORDER BY created_at DESC
    `);
  }

  // ─── Open ─────────────────────────────────────────────────────────────────

  static open(dbPath: string): GoalStore {
    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    db.exec(CREATE_GOALS_TABLE);
    db.exec(CREATE_GOALS_INDEXES);
    return new GoalStore(db);
  }

  // ─── Write ────────────────────────────────────────────────────────────────

  /**
   * Create a new goal. Returns the assigned ULID.
   * The goal is active by default.
   */
  write(input: GoalInput): string {
    const id  = ulid();
    const now = Date.now();
    this.insertStmt.run({
      id,
      description: input.description,
      frame_id:    input.frame_id ?? null,
      desired:     JSON.stringify(input.desired ?? {}),
      created_at:  now,
      updated_at:  now,
    });
    return id;
  }

  // ─── Read ─────────────────────────────────────────────────────────────────

  /** Fetch a goal by ULID. Returns null if not found. */
  getById(id: string): Goal | null {
    const row = this.getByIdStmt.get({ id }) as RawRow | undefined;
    return row ? rowToGoal(row) : null;
  }

  /** List all active goals (active = true). */
  listActive(): Goal[] {
    const rows = this.listActiveStmt.all() as RawRow[];
    return rows.map(rowToGoal);
  }

  /**
   * List all goals regardless of status, most recently created first.
   */
  list(opts: { limit?: number; offset?: number } = {}): Goal[] {
    const { limit = 100, offset = 0 } = opts;
    const rows = this.listStmt.all({ limit, offset }) as RawRow[];
    return rows.map(rowToGoal);
  }

  // ─── Update ───────────────────────────────────────────────────────────────

  /** Mark a goal active or inactive (achieved/abandoned). */
  setActive(id: string, active: boolean): void {
    this.setActiveStmt.run({ id, active: active ? 1 : 0, updated_at: Date.now() });
  }

  // ─── Utilities ────────────────────────────────────────────────────────────

  count(): number {
    const row = this.db.prepare("SELECT COUNT(*) as n FROM goals").get() as { n: number };
    return row.n;
  }

  close(): void {
    this.db.close();
  }
}
