/**
 * Read-only view of the Society of Mind event log.
 *
 * The introspection app is a B-Brain consumer — it reads the audit trail but
 * never writes to it. This reader is intentionally separate from the core
 * EventLog writer to enforce that boundary.
 *
 * Opens the DB in read-only mode so even a bug here can't corrupt the log.
 */
import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SignalType } from "../types";

export const DEFAULT_DB_PATH = join(homedir(), ".som", "events.db");

// Raw SQLite row — all fields TEXT or INTEGER
interface RawRow {
  id: string;
  timestamp: number;
  source: string;
  signal: string;
  type: string;
  payload: string;
  context: string;
  caused_by: string | null;
}

export interface LiveEvent {
  id: string;
  timestamp: number;
  source: string;
  signal: string;
  type: SignalType;
  /** Human-readable description: agents may include { summary } in payload */
  summary: string;
  causedBy: string | null;
  payload: Record<string, unknown>;
}

function rowToEvent(row: RawRow): LiveEvent {
  const payload = JSON.parse(row.payload) as Record<string, unknown>;
  return {
    id: row.id,
    timestamp: row.timestamp,
    source: row.source,
    signal: row.signal,
    type: row.type as SignalType,
    summary: typeof payload.summary === "string" ? payload.summary : row.signal,
    causedBy: row.caused_by,
    payload,
  };
}

export class EventLogReader {
  private readonly db: Database.Database;
  private readonly tailStmt: Database.Statement;
  private readonly recentStmt: Database.Statement;
  private readonly getByIdStmt: Database.Statement;
  private readonly activationStatesStmt: Database.Statement;

  private constructor(db: Database.Database) {
    this.db = db;
    this.tailStmt   = db.prepare("SELECT * FROM events WHERE id > @since ORDER BY id ASC LIMIT 200");
    this.recentStmt = db.prepare("SELECT * FROM events ORDER BY id DESC LIMIT @limit");
    this.getByIdStmt = db.prepare("SELECT * FROM events WHERE id = @id");
    this.activationStatesStmt = db.prepare(`
      SELECT e.source, e.signal
      FROM events e
      INNER JOIN (
        SELECT source, MAX(id) as latest_id
        FROM events
        WHERE signal IN ('agent.active','agent.dormant','agency.active','agency.dormant')
        GROUP BY source
      ) latest ON e.id = latest.latest_id
    `);
  }

  /**
   * Try to open the event log at the given path in read-only mode.
   * Returns null if the file does not exist yet (society hasn't started).
   */
  static tryOpen(dbPath = DEFAULT_DB_PATH): EventLogReader | null {
    if (!existsSync(dbPath)) return null;
    const db = new Database(dbPath, { readonly: true });
    return new EventLogReader(db);
  }

  /**
   * Poll for new events since `since` (ULID cursor).
   * Returns events in ascending order (oldest first).
   */
  poll(since: string): LiveEvent[] {
    const rows = this.tailStmt.all({ since }) as RawRow[];
    return rows.map(rowToEvent);
  }

  /**
   * Return the last `limit` events, oldest first.
   */
  recent(limit = 100): LiveEvent[] {
    const rows = this.recentStmt.all({ limit }) as RawRow[];
    return rows.map(rowToEvent).reverse();
  }

  /** Fetch a single event by ULID. Returns null if not found. */
  getById(id: string): LiveEvent | null {
    const row = this.getByIdStmt.get({ id }) as RawRow | undefined;
    return row ? rowToEvent(row) : null;
  }

  /** Return the most-recent activation state per agent/agency source. */
  activationStates(): Array<{ id: string; state: "active" | "dormant" }> {
    const rows = this.activationStatesStmt.all() as Array<{ source: string; signal: string }>;
    return rows.map(({ source, signal }) => ({
      id:    source,
      state: (signal === "agent.active" || signal === "agency.active") ? "active" : "dormant",
    }));
  }

  close(): void {
    this.db.close();
  }
}
