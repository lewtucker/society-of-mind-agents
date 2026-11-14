import Database from "better-sqlite3";
import { monotonicFactory } from "ulid";
import {
  CREATE_FRAME_ARRAYS_TABLE,
  CREATE_FRAMES_FTS,
  CREATE_FRAMES_TABLE,
  CREATE_INDEXES,
  CREATE_META_TABLE,
  SET_SCHEMA_VERSION,
} from "./schema.ts";
import {
  isTransFrame,
  type Frame,
  type FrameArrayInput,
  type FrameArrayRecord,
  type FrameInput,
  type FrameListOptions,
  type Terminal,
  type TransFrame,
  type TransFrameRoles,
} from "./types.ts";

const ulid = monotonicFactory();

const MAX_INHERITANCE_DEPTH = 32;

// ─── Raw DB row ───────────────────────────────────────────────────────────────

interface RawRow {
  id:              string;
  name:            string;
  description:     string;
  terminals:       string;
  parent_frame_id: string | null;
  frame_type:      string;
  roles:           string | null;
  created_at:      number;
  updated_at:      number;
}

interface RawArrayRow {
  id:         string;
  name:       string;
  frame_ids:  string;
  created_at: number;
  updated_at: number;
}

function rowToFrame(row: RawRow): Frame {
  return {
    id:              row.id,
    name:            row.name,
    description:     row.description,
    terminals:       JSON.parse(row.terminals) as Record<string, Terminal>,
    parent_frame_id: row.parent_frame_id,
    frame_type:      (row.frame_type ?? "standard") as Frame["frame_type"],
    roles:           row.roles ? JSON.parse(row.roles) as TransFrameRoles : null,
    created_at:      row.created_at,
    updated_at:      row.updated_at,
  };
}

function rowToFrameArray(row: RawArrayRow): FrameArrayRecord {
  return {
    id:         row.id,
    name:       row.name,
    frame_ids:  JSON.parse(row.frame_ids) as string[],
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ─── FrameStore ───────────────────────────────────────────────────────────────

/**
 * Persistent storage for Frames — the knowledge templates of the society.
 *
 * Minsky §25: "A frame is a data-structure for representing a stereotyped
 * situation… Each terminal can be assigned a default assumption."
 *
 * FrameStore is separate from KLineStore and EventLog because frames are
 * long-lived schema objects (not episodic memories). They are typically
 * written once at system startup and read many times during reasoning.
 *
 * Key methods:
 *   write(input)              — create a new frame (ULID assigned)
 *   getById(id)               — fetch by ULID
 *   getByName(name)           — fetch by unique name
 *   getWithInheritance(id)    — merged frame: child terminals shadow parent
 *   list(opts)                — all frames or filtered by parent
 *   searchFts(query)          — BM25-ranked name/description search
 *   update(id, patch)         — update description and/or terminals
 */
export class FrameStore {
  private readonly db: Database.Database;

  private readonly insertStmt:            Database.Statement;
  private readonly insertFtsStmt:         Database.Statement;
  private readonly updateFtsStmt:         Database.Statement;
  private readonly getByIdStmt:           Database.Statement;
  private readonly getByNameStmt:         Database.Statement;
  private readonly updateStmt:            Database.Statement;
  private readonly insertArrayStmt:       Database.Statement;
  private readonly getArrayByIdStmt:      Database.Statement;
  private readonly getArrayByNameStmt:    Database.Statement;

  private constructor(db: Database.Database) {
    this.db = db;

    this.insertStmt = db.prepare(`
      INSERT INTO frames (id, name, description, terminals, parent_frame_id, frame_type, roles, created_at, updated_at)
      VALUES (@id, @name, @description, @terminals, @parent_frame_id, @frame_type, @roles, @created_at, @updated_at)
    `);

    this.insertFtsStmt = db.prepare(`
      INSERT INTO frames_fts (frame_id, name, description)
      VALUES (@frame_id, @name, @description)
    `);

    this.updateFtsStmt = db.prepare(`
      UPDATE frames_fts SET name = @name, description = @description
      WHERE frame_id = @frame_id
    `);

    this.getByIdStmt = db.prepare(`SELECT * FROM frames WHERE id = @id`);

    this.getByNameStmt = db.prepare(`SELECT * FROM frames WHERE name = @name`);

    this.updateStmt = db.prepare(`
      UPDATE frames
      SET description = @description, terminals = @terminals, updated_at = @updated_at
      WHERE id = @id
    `);

    this.insertArrayStmt = db.prepare(`
      INSERT INTO frame_arrays (id, name, frame_ids, created_at, updated_at)
      VALUES (@id, @name, @frame_ids, @created_at, @updated_at)
    `);

    this.getArrayByIdStmt   = db.prepare(`SELECT * FROM frame_arrays WHERE id = @id`);
    this.getArrayByNameStmt = db.prepare(`SELECT * FROM frame_arrays WHERE name = @name`);
  }

  // ─── Open ──────────────────────────────────────────────────────────────────

  static open(dbPath: string): FrameStore {
    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    db.pragma("foreign_keys = ON");
    FrameStore.runSchema(db);
    return new FrameStore(db);
  }

  static openReadOnly(dbPath: string): FrameStore {
    const db = new Database(dbPath, { readonly: true });
    return new FrameStore(db);
  }

  private static runSchema(db: Database.Database): void {
    db.exec(CREATE_META_TABLE);
    db.exec(SET_SCHEMA_VERSION);
    db.exec(CREATE_FRAMES_TABLE);
    db.exec(CREATE_FRAMES_FTS);
    db.exec(CREATE_FRAME_ARRAYS_TABLE);
    db.exec(CREATE_INDEXES);
  }

  // ─── Write ─────────────────────────────────────────────────────────────────

  /**
   * Create a new frame. Returns the assigned ULID.
   *
   * Frame names must be unique. Attempting to write a duplicate name throws
   * a SQLite UNIQUE constraint error — callers should check first with
   * getByName() or use upsertByName().
   */
  write(input: FrameInput): string {
    const id  = ulid();
    const now = Date.now();

    const doWrite = this.db.transaction(() => {
      this.insertStmt.run({
        id,
        name:            input.name,
        description:     input.description,
        terminals:       JSON.stringify(input.terminals ?? {}),
        parent_frame_id: input.parent_frame_id ?? null,
        frame_type:      input.frame_type ?? "standard",
        roles:           input.roles ? JSON.stringify(input.roles) : null,
        created_at:      now,
        updated_at:      now,
      });

      this.insertFtsStmt.run({
        frame_id:    id,
        name:        input.name,
        description: input.description,
      });
    });

    doWrite();
    return id;
  }

  /**
   * Write a frame if it doesn't exist; return its id whether new or existing.
   * Useful for idempotent system-startup frame seeding.
   */
  upsertByName(input: FrameInput): string {
    const existing = this.getByName(input.name);
    if (existing) return existing.id;
    return this.write(input);
  }

  // ─── Read ──────────────────────────────────────────────────────────────────

  /** Fetch a single frame by ULID. Returns null if not found. */
  getById(id: string): Frame | null {
    const row = this.getByIdStmt.get({ id }) as RawRow | undefined;
    return row ? rowToFrame(row) : null;
  }

  /** Fetch a frame by its unique name. Returns null if not found. */
  getByName(name: string): Frame | null {
    const row = this.getByNameStmt.get({ name }) as RawRow | undefined;
    return row ? rowToFrame(row) : null;
  }

  /**
   * Return a frame with its full inherited terminal set.
   *
   * Inheritance rule (prototype chain):
   *   1. Walk parent_frame_id chain up to MAX_INHERITANCE_DEPTH
   *   2. Merge terminals from root → child (child definitions win)
   *   3. Return a new Frame object with the child's id/name/description
   *      but the merged terminal set
   *
   * This means: if a parent defines `Actor` with confidence 0.3 and the
   * child redefines `Actor` with confidence 0.9, the child's definition wins.
   *
   * Returns null if the frame id is not found.
   */
  getWithInheritance(id: string): Frame | null {
    // Walk the chain collecting frames from leaf to root
    const chain: Frame[] = [];
    let current: Frame | null = this.getById(id);

    while (current && chain.length < MAX_INHERITANCE_DEPTH) {
      chain.push(current);
      current = current.parent_frame_id
        ? this.getById(current.parent_frame_id)
        : null;
    }

    if (chain.length === 0) return null;

    // Merge terminals: root first (index = chain.length-1), child last (index 0)
    // Later assignments win, so child terminals shadow parent terminals
    const mergedTerminals: Record<string, Terminal> = {};
    for (let i = chain.length - 1; i >= 0; i--) {
      Object.assign(mergedTerminals, chain[i].terminals);
    }

    const leaf = chain[0];
    return {
      ...leaf,
      terminals: mergedTerminals,
    };
  }

  /**
   * List frames. Default: all frames, most recently created first.
   * Pass `parentId: null` to get only root frames (no parent).
   * Pass `parentId: someId` to get direct children of that frame.
   */
  list(opts: FrameListOptions = {}): Frame[] {
    const { limit = 100, offset = 0 } = opts;
    const params: Record<string, unknown> = { limit, offset };

    let where = "";
    if ("parentId" in opts) {
      if (opts.parentId === null) {
        where = "WHERE parent_frame_id IS NULL";
      } else {
        where = "WHERE parent_frame_id = @parentId";
        params.parentId = opts.parentId;
      }
    }

    const sql  = `SELECT * FROM frames ${where} ORDER BY created_at DESC LIMIT @limit OFFSET @offset`;
    const rows = this.db.prepare(sql).all(params) as RawRow[];
    return rows.map(rowToFrame);
  }

  /**
   * BM25-ranked full-text search on frame name and description.
   * Returns frames (not just ids) ordered by relevance.
   */
  searchFts(query: string, limit = 10): Frame[] {
    const safe = sanitizeFts(query);
    if (!safe) return [];
    const rows = this.db.prepare(`
      SELECT f.*
      FROM frames f
      JOIN frames_fts fts ON fts.frame_id = f.id
      WHERE frames_fts MATCH @query
      ORDER BY fts.rank
      LIMIT @limit
    `).all({ query: safe, limit }) as RawRow[];
    return rows.map(rowToFrame);
  }

  // ─── Update ────────────────────────────────────────────────────────────────

  /**
   * Update a frame's description and/or terminals.
   *
   * Frame names and parent_frame_id are immutable after creation
   * (they form the identity and inheritance tree structure).
   * To rename, create a new frame and migrate references.
   */
  update(id: string, patch: { description?: string; terminals?: Record<string, Terminal> }): void {
    const existing = this.getById(id);
    if (!existing) throw new Error(`Frame not found: ${id}`);

    const description = patch.description ?? existing.description;
    const terminals   = patch.terminals   ?? existing.terminals;

    const doUpdate = this.db.transaction(() => {
      this.updateStmt.run({
        id,
        description,
        terminals:  JSON.stringify(terminals),
        updated_at: Date.now(),
      });
      this.updateFtsStmt.run({
        frame_id:    id,
        name:        existing.name,
        description,
      });
    });

    doUpdate();
  }

  // ─── Trans-frames ──────────────────────────────────────────────────────────

  /**
   * Write a trans-frame — a Frame with the six canonical trans-frame roles.
   *
   * Minsky §21: trans-frames represent transformations (Actor performs Action
   * on Object, moving it from Origin to Destination using Instrument).
   * The roles are stored separately from the terminal slot-filling machinery.
   */
  writeTransFrame(input: FrameInput & { roles: TransFrameRoles }): string {
    return this.write({ ...input, frame_type: "trans" });
  }

  /**
   * Fetch a frame and narrow it to TransFrame. Returns null if the frame is
   * not found or is not a trans-frame.
   */
  getTransFrame(id: string): TransFrame | null {
    const frame = this.getById(id);
    if (!frame || !isTransFrame(frame)) return null;
    return frame as TransFrame;
  }

  // ─── Frame-arrays ──────────────────────────────────────────────────────────

  /**
   * Write a frame-array — a named collection of frames sharing terminal
   * vocabulary. Returns the assigned ULID.
   *
   * All frame_ids in `input.frame_ids` must already exist in the store.
   * (This is not enforced at the DB level — callers are responsible.)
   */
  writeFrameArray(input: FrameArrayInput): string {
    const id  = ulid();
    const now = Date.now();
    this.insertArrayStmt.run({
      id,
      name:       input.name,
      frame_ids:  JSON.stringify(input.frame_ids),
      created_at: now,
      updated_at: now,
    });
    return id;
  }

  /** Fetch a frame-array by ULID. Returns null if not found. */
  getFrameArray(id: string): FrameArrayRecord | null {
    const row = this.getArrayByIdStmt.get({ id }) as RawArrayRow | undefined;
    return row ? rowToFrameArray(row) : null;
  }

  /** Fetch a frame-array by name. Returns null if not found. */
  getFrameArrayByName(name: string): FrameArrayRecord | null {
    const row = this.getArrayByNameStmt.get({ name }) as RawArrayRow | undefined;
    return row ? rowToFrameArray(row) : null;
  }

  /**
   * Switch perspective within a frame-array.
   *
   * Minsky §24: switching frames in a frame-array preserves terminal values
   * whose names appear in the target frame. Values unique to the current
   * perspective are dropped; the target frame's defaults fill the rest.
   *
   * Returns:
   *   frame     — the target Frame (with inheritance applied)
   *   preserved — subset of currentValues whose keys match target terminals
   *
   * The caller passes `preserved` as `payload` to `fillSlots()` so that
   * shared values survive the perspective switch.
   *
   * Returns null if `arrayId` or `toFrameId` is not found, or if
   * `toFrameId` is not a member of the array.
   */
  switchPerspective(
    arrayId:       string,
    toFrameId:     string,
    currentValues: Record<string, unknown>,
  ): { frame: Frame; preserved: Record<string, unknown> } | null {
    const arr = this.getFrameArray(arrayId);
    if (!arr) return null;
    if (!arr.frame_ids.includes(toFrameId)) return null;

    const frame = this.getWithInheritance(toFrameId);
    if (!frame) return null;

    // Preserve any current value whose key matches a terminal in the target frame
    const targetKeys = new Set(
      Object.keys(frame.terminals).map((k) => k.toLowerCase()),
    );
    const preserved: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(currentValues)) {
      if (targetKeys.has(k.toLowerCase())) {
        preserved[k] = v;
      }
    }

    return { frame, preserved };
  }

  // ─── Utilities ─────────────────────────────────────────────────────────────

  count(): number {
    const row = this.db.prepare("SELECT COUNT(*) as n FROM frames").get() as { n: number };
    return row.n;
  }

  close(): void {
    this.db.close();
  }
}

// ─── FTS query sanitizer ──────────────────────────────────────────────────────

function sanitizeFts(query: string): string {
  const tokens = query
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
  return tokens.map((t) => `"${t}"`).join(" ");
}
