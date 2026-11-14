import Database from "better-sqlite3";
import { monotonicFactory } from "ulid";
import {
  CREATE_EMBEDDING_CACHE,
  CREATE_FTS_TABLE,
  CREATE_INDEXES,
  CREATE_KLINES_TABLE,
  CREATE_META_TABLE,
  CREATE_RETRIEVAL_LOG,
  SET_SCHEMA_VERSION,
} from "./schema.ts";
import type { KLine, KLineInput, KLineListOptions, KLineType } from "./types.ts";

const ulid = monotonicFactory();

// ─── FTS query sanitizer ──────────────────────────────────────────────────────

/**
 * Sanitize a free-text string into a safe FTS5 query.
 *
 * FTS5 uses hyphens as NOT operators and interprets `word:term` as column
 * filters. Strip punctuation, split into tokens, double-quote each token so
 * FTS5 treats them as exact terms rather than operators.
 *
 * Example: "load-bearing block" → `"load" "bearing" "block"`
 */
function sanitizeFtsQuery(query: string): string {
  const tokens = query
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
  return tokens.map((t) => `"${t}"`).join(" ");
}

// ─── Raw DB row ───────────────────────────────────────────────────────────────

interface RawRow {
  id:              string;
  type:            string;
  created_at:      number;
  updated_at:      number;
  situation_desc:  string;
  frame_id:        string | null;
  pronomes:        string;
  realm:           string;
  micronemes:      string;
  activations:     string;
  bands:           string;
  guard:           string | null;
  parent_id:       string | null;
  child_ids:       string;
  source_events:   string;
  task_id:         string | null;
  retrieval_count: number;
  last_retrieved:  number | null;
  embedding:       string;
  embedding_model: string;
  embedding_hash:  string;
}

function rowToKLine(row: RawRow): KLine {
  return {
    id:              row.id,
    type:            row.type as KLineType,
    created_at:      row.created_at,
    updated_at:      row.updated_at,
    situation: {
      description: row.situation_desc,
      frame_id:    row.frame_id,
      pronomes:    JSON.parse(row.pronomes),
      micronemes:  JSON.parse(row.micronemes),
      realm:       JSON.parse(row.realm),
    },
    activations:     JSON.parse(row.activations),
    bands:           JSON.parse(row.bands),
    guard:           row.guard ? JSON.parse(row.guard) : null,
    parent_id:       row.parent_id,
    child_ids:       JSON.parse(row.child_ids),
    source_events:   JSON.parse(row.source_events),
    task_id:         row.task_id,
    retrieval_count: row.retrieval_count,
    last_retrieved:  row.last_retrieved,
    embedding:       JSON.parse(row.embedding),
    embedding_model: row.embedding_model,
    embedding_hash:  row.embedding_hash,
  };
}

// ─── KLineStore ───────────────────────────────────────────────────────────────

/**
 * Persistent storage for K-line memories.
 *
 * Minsky: "A K-line is a mental state — a record of which agents were active
 * when something worked."
 *
 * KLineStore is a write-once, read-many store. K-lines accumulate over sessions.
 * The store is intentionally separate from the EventLog so it can be:
 *   - Written only by MemoryManager (agent responsible for memory capture)
 *   - Read by any agent during retrieval
 *   - Read by the introspection app (read-only mode, B-Brain principle)
 *
 * Phase 2.1: schema + CRUD. FTS5 full-text index included.
 * Phase 2.2: adds sqlite-vec for cosine similarity search + hybrid retrieval.
 */
export class KLineStore {
  private readonly db: Database.Database;
  private readonly readonly: boolean;

  private readonly insertStmt: Database.Statement;
  private readonly insertFtsStmt: Database.Statement;
  private readonly updateChildIdsStmt: Database.Statement;
  private readonly getByIdStmt: Database.Statement;
  private readonly countStmt: Database.Statement;
  private readonly incrementRetrievalStmt: Database.Statement;

  private constructor(db: Database.Database, readonly_: boolean) {
    this.db       = db;
    this.readonly = readonly_;

    this.insertStmt = db.prepare(`
      INSERT INTO klines (
        id, type, created_at, updated_at, situation_desc, frame_id,
        pronomes, realm, micronemes, activations, bands, guard,
        parent_id, child_ids, source_events, task_id,
        retrieval_count, last_retrieved, embedding, embedding_model, embedding_hash
      ) VALUES (
        @id, @type, @created_at, @updated_at, @situation_desc, @frame_id,
        @pronomes, @realm, @micronemes, @activations, @bands, @guard,
        @parent_id, @child_ids, @source_events, @task_id,
        0, NULL, @embedding, @embedding_model, @embedding_hash
      )
    `);

    this.insertFtsStmt = db.prepare(`
      INSERT INTO klines_fts (kline_id, situation_desc, guard_precursor)
      VALUES (@kline_id, @situation_desc, @guard_precursor)
    `);

    this.updateChildIdsStmt = db.prepare(`
      UPDATE klines SET child_ids = @child_ids, updated_at = @updated_at
      WHERE id = @id
    `);

    this.getByIdStmt = db.prepare(`
      SELECT * FROM klines WHERE id = @id
    `);

    this.countStmt = db.prepare(`
      SELECT COUNT(*) as n FROM klines WHERE (@type IS NULL OR type = @type)
    `);

    this.incrementRetrievalStmt = db.prepare(`
      UPDATE klines
      SET retrieval_count = retrieval_count + 1, last_retrieved = @now
      WHERE id = @id
    `);
  }

  // ─── Open ──────────────────────────────────────────────────────────────────

  /**
   * Open read-write. Only MemoryManager should call this.
   * WAL mode for concurrent readers.
   */
  static open(dbPath: string): KLineStore {
    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    db.pragma("foreign_keys = ON");
    KLineStore.runSchema(db);
    return new KLineStore(db, false);
  }

  /**
   * Open read-only. Introspection app and retrieval agents use this.
   * Enforces the B-Brain principle — observers never write.
   */
  static openReadOnly(dbPath: string): KLineStore {
    const db = new Database(dbPath, { readonly: true });
    return new KLineStore(db, true);
  }

  private static runSchema(db: Database.Database): void {
    db.exec(CREATE_META_TABLE);
    db.exec(CREATE_KLINES_TABLE);
    db.exec(CREATE_FTS_TABLE);
    db.exec(CREATE_EMBEDDING_CACHE);
    db.exec(CREATE_RETRIEVAL_LOG);
    db.exec(CREATE_INDEXES);
    db.exec(SET_SCHEMA_VERSION);
  }

  // ─── Write ─────────────────────────────────────────────────────────────────

  /**
   * Write a K-line. Returns the assigned ULID.
   *
   * If `input.parent_id` is set, the parent's `child_ids` array is updated
   * atomically (within a transaction) to include the new K-line.
   *
   * FTS index is updated in the same transaction.
   */
  write(input: KLineInput): string {
    if (this.readonly) throw new Error("KLineStore is open read-only");

    const id  = ulid();
    const now = Date.now();

    const write = this.db.transaction(() => {
      this.insertStmt.run({
        id,
        type:            input.type,
        created_at:      now,
        updated_at:      now,
        situation_desc:  input.situation.description,
        frame_id:        input.situation.frame_id ?? null,
        pronomes:        JSON.stringify(input.situation.pronomes),
        realm:           JSON.stringify(input.situation.realm),
        micronemes:      JSON.stringify(input.situation.micronemes),
        activations:     JSON.stringify(input.activations),
        bands:           JSON.stringify(input.bands),
        guard:           input.guard ? JSON.stringify(input.guard) : null,
        parent_id:       input.parent_id ?? null,
        child_ids:       "[]",
        source_events:   JSON.stringify(input.source_events ?? []),
        task_id:         input.task_id ?? null,
        embedding:       JSON.stringify(input.embedding ?? []),
        embedding_model: input.embedding_model ?? "none",
        embedding_hash:  input.embedding_hash ?? "",
      });

      // FTS: index situation description and censor precursor pattern
      this.insertFtsStmt.run({
        kline_id:        id,
        situation_desc:  input.situation.description,
        guard_precursor: input.guard?.precursor_pattern ?? "",
      });

      // Maintain reverse hierarchy: add id to parent's child_ids
      if (input.parent_id) {
        const parentRow = this.getByIdStmt.get({ id: input.parent_id }) as RawRow | undefined;
        if (parentRow) {
          const childIds: string[] = JSON.parse(parentRow.child_ids);
          childIds.push(id);
          this.updateChildIdsStmt.run({
            id:        input.parent_id,
            child_ids: JSON.stringify(childIds),
            updated_at: now,
          });
        }
      }
    });

    write();
    return id;
  }

  // ─── Read ──────────────────────────────────────────────────────────────────

  /** Fetch a single K-line by id. Returns null if not found. */
  getById(id: string): KLine | null {
    const row = this.getByIdStmt.get({ id }) as RawRow | undefined;
    return row ? rowToKLine(row) : null;
  }

  /**
   * List K-lines with optional filters.
   * Default: most recently created first, limit 100.
   */
  list(opts: KLineListOptions = {}): KLine[] {
    const {
      type,
      frameId,
      taskId,
      limit  = 100,
      offset = 0,
      orderBy = "created_at",
      desc = true,
    } = opts;

    // Build query dynamically based on provided filters
    const conditions: string[] = [];
    const params: Record<string, unknown> = { limit, offset };

    if (type) {
      if (Array.isArray(type)) {
        // e.g. type IN ('positive','abstract')
        const placeholders = type.map((_, i) => `@type${i}`).join(", ");
        conditions.push(`type IN (${placeholders})`);
        type.forEach((t, i) => { params[`type${i}`] = t; });
      } else {
        conditions.push("type = @type");
        params.type = type;
      }
    }
    if (frameId !== undefined) {
      conditions.push("frame_id = @frameId");
      params.frameId = frameId;
    }
    if (taskId !== undefined) {
      conditions.push("task_id = @taskId");
      params.taskId = taskId;
    }

    const where  = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const order  = `ORDER BY ${orderBy} ${desc ? "DESC" : "ASC"}`;
    const sql    = `SELECT * FROM klines ${where} ${order} LIMIT @limit OFFSET @offset`;
    const rows   = this.db.prepare(sql).all(params) as RawRow[];
    return rows.map(rowToKLine);
  }

  /**
   * Full-text search on situation descriptions and censor precursor patterns.
   * Returns K-line ids ordered by BM25 relevance (best match first).
   * Used in Phase 2.2 hybrid retrieval.
   */
  searchFts(query: string, limit = 20): string[] {
    const safe = sanitizeFtsQuery(query);
    if (!safe) return [];
    const rows = this.db.prepare(`
      SELECT kline_id FROM klines_fts
      WHERE klines_fts MATCH @query
      ORDER BY rank
      LIMIT @limit
    `).all({ query: safe, limit }) as Array<{ kline_id: string }>;
    return rows.map((r) => r.kline_id);
  }

  /**
   * FTS search that also returns BM25 rank values.
   * rank is negative (lower = better match) — passed to hybridScore as-is.
   */
  searchFtsWithRanks(query: string, limit = 50): Array<{ id: string; rank: number }> {
    const safe = sanitizeFtsQuery(query);
    if (!safe) return [];
    const rows = this.db.prepare(`
      SELECT kline_id, rank FROM klines_fts
      WHERE klines_fts MATCH @query
      ORDER BY rank
      LIMIT @limit
    `).all({ query: safe, limit }) as Array<{ kline_id: string; rank: number }>;
    return rows.map((r) => ({ id: r.kline_id, rank: r.rank }));
  }

  // ─── Retrieval tracking ────────────────────────────────────────────────────

  /**
   * Increment the retrieval count for a K-line and update last_retrieved.
   * Called by the retrieval agent each time a K-line is used.
   * Forms the foundation of the Investment Principle — frequently retrieved
   * K-lines are candidates for promotion to "abstract" type.
   */
  incrementRetrievalCount(id: string): void {
    if (this.readonly) throw new Error("KLineStore is open read-only");
    this.incrementRetrievalStmt.run({ id, now: Date.now() });
  }

  // ─── Utilities ─────────────────────────────────────────────────────────────

  /** Total K-lines, optionally filtered by type. */
  count(type?: KLineType): number {
    const row = this.countStmt.get({ type: type ?? null }) as { n: number };
    return row.n;
  }

  close(): void {
    this.db.close();
  }
}
