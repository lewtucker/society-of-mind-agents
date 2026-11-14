import Database from "better-sqlite3";
import { monotonicFactory } from "ulid";

// monotonicFactory guarantees lexicographic order even for multiple ULIDs
// generated within the same millisecond — essential for correct tail() ordering.
const ulid = monotonicFactory();
import {
  CREATE_EVENTS_TABLE,
  CREATE_INDEXES,
  CREATE_META_TABLE,
  SET_SCHEMA_VERSION,
} from "./schema.ts";
import type { EmitInput, SignalEnvelope, TailOptions } from "./types.ts";

// ─── Raw DB row (all fields are TEXT or INTEGER from SQLite) ─────────────────

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

function rowToEnvelope(row: RawRow): SignalEnvelope {
  return {
    id: row.id,
    timestamp: row.timestamp,
    source: row.source,
    signal: row.signal,
    type: row.type as SignalEnvelope["type"],
    payload: JSON.parse(row.payload),
    context: JSON.parse(row.context),
    causedBy: row.caused_by,
  };
}

// ─── EventLog ────────────────────────────────────────────────────────────────

export class EventLog {
  private readonly db: Database.Database;

  private readonly insertStmt: Database.Statement;
  private readonly tailStmt: Database.Statement;
  private readonly recentDescStmt: Database.Statement;
  private readonly recentAscStmt: Database.Statement;
  private readonly getByIdStmt: Database.Statement;
  private readonly activationStatesStmt: Database.Statement;

  private constructor(db: Database.Database) {
    this.db = db;

    this.insertStmt = db.prepare(`
      INSERT INTO events (id, timestamp, source, signal, type, payload, context, caused_by)
      VALUES (@id, @timestamp, @source, @signal, @type, @payload, @context, @caused_by)
    `);

    // tail: events strictly after a given id, ascending (oldest-first delivery)
    this.tailStmt = db.prepare(`
      SELECT * FROM events WHERE id > @since ORDER BY id ASC LIMIT 200
    `);

    // recent: last N events, newest first (for initial introspection load)
    this.recentDescStmt = db.prepare(`
      SELECT * FROM events ORDER BY id DESC LIMIT @limit
    `);

    // recent since id: events after a given id, oldest first
    this.recentAscStmt = db.prepare(`
      SELECT * FROM events WHERE id > @since ORDER BY id ASC LIMIT @limit
    `);

    // fetch a single event by exact id
    this.getByIdStmt = db.prepare(`
      SELECT * FROM events WHERE id = @id
    `);

    // latest activation signal per source (for ACTIVATION_QUERY)
    this.activationStatesStmt = db.prepare(`
      SELECT e.source, e.signal
      FROM events e
      INNER JOIN (
        SELECT source, MAX(id) as latest_id
        FROM events
        WHERE signal IN ('agent.active', 'agent.dormant', 'agency.active', 'agency.dormant')
        GROUP BY source
      ) latest ON e.id = latest.latest_id
    `);
  }

  /**
   * Open (or create) the event log at the given file path.
   * Runs schema migrations, enables WAL mode, and prepares statements.
   */
  static open(dbPath: string): EventLog {
    const db = new Database(dbPath);

    // WAL mode: allows concurrent readers while a writer is active
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL"); // Safe with WAL; faster than FULL
    db.pragma("foreign_keys = ON");

    // Schema
    db.exec(CREATE_META_TABLE);
    db.exec(CREATE_EVENTS_TABLE);
    db.exec(CREATE_INDEXES);
    db.exec(SET_SCHEMA_VERSION);

    return new EventLog(db);
  }

  /**
   * Emit a signal onto the bus.
   * Assigns a ULID id and the current timestamp, writes to DB, returns the id.
   */
  emit(input: EmitInput): string {
    const id = ulid();
    const timestamp = Date.now();

    this.insertStmt.run({
      id,
      timestamp,
      source: input.source,
      signal: input.signal,
      type: input.type,
      payload: JSON.stringify(input.payload ?? {}),
      context: JSON.stringify(
        input.context ?? { pronomes: {}, frame_id: null, kline_ids: [], micronemes: [] }
      ),
      caused_by: input.causedBy ?? null,
    });

    return id;
  }

  /**
   * Stream new events as they are written.
   *
   * Polls the DB every `pollMs` ms (default 250). Calls `onEvent` for each
   * new event in insertion order. Picks up from `since` if provided — pass
   * the last seen event id to resume without replaying history.
   *
   * Returns a stop function. Call it to cancel the tail.
   */
  tail(opts: TailOptions): () => void {
    let lastId = opts.since ?? "";
    const pollMs = opts.pollMs ?? 250;

    const poll = () => {
      const rows = this.tailStmt.all({ since: lastId }) as RawRow[];
      for (const row of rows) {
        lastId = row.id;
        opts.onEvent(rowToEnvelope(row));
      }
    };

    // Deliver any already-existing events immediately before starting the interval
    poll();
    const timer = setInterval(poll, pollMs);
    return () => clearInterval(timer);
  }

  /**
   * Return recent events synchronously (for initial page load / snapshot).
   *
   * Without `since`: returns the last `limit` events, newest first.
   * With `since`:    returns up to `limit` events after that id, oldest first.
   */
  recent(limit = 100, since?: string): SignalEnvelope[] {
    if (since !== undefined) {
      const rows = this.recentAscStmt.all({ since, limit }) as RawRow[];
      return rows.map(rowToEnvelope);
    }
    const rows = this.recentDescStmt.all({ limit }) as RawRow[];
    return rows.map(rowToEnvelope).reverse(); // return oldest-first
  }

  /** Fetch a single event by id. Returns null if not found. */
  getById(id: string): SignalEnvelope | null {
    const row = this.getByIdStmt.get({ id }) as RawRow | undefined;
    return row ? rowToEnvelope(row) : null;
  }

  /**
   * Return the most-recent activation signal per source.
   * Used by ACTIVATION_QUERY to reconstruct current agent/agency states.
   */
  getActivationStates(): Array<{ source: string; signal: string }> {
    return this.activationStatesStmt.all() as Array<{ source: string; signal: string }>;
  }

  /** Total number of events in the log. */
  count(): number {
    const row = this.db.prepare("SELECT COUNT(*) as n FROM events").get() as { n: number };
    return row.n;
  }

  close(): void {
    this.db.close();
  }
}
