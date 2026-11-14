/**
 * Read-only view of the Society of Mind K-line memory store.
 *
 * B-Brain principle: opens SQLite in readonly mode — the introspection app
 * observes memory but never writes to it.
 *
 * Includes an inline BagOfWordsEmbedder (64d) so the MEMORY_PROBE query can
 * perform cosine similarity against stored embeddings without importing @som/core.
 * Embeddings are only comparable when both query and stored K-line used the same
 * 64d model — mismatched dims fall back to FTS-only scoring.
 */
import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_KLINE_DB_PATH = join(homedir(), ".som", "klines.db");

// ─── Types ────────────────────────────────────────────────────────────────────

export type KLineType = "positive" | "censor" | "suppressor" | "abstract";
export type BandName  = "core" | "peripheral" | "fringe";

export interface KLineBandData {
  agents:     string[];
  decay_rate: number;
}

export interface KLineGuardData {
  precursor_pattern:   string;
  blocked_action:      string;
  outcome_description: string;
}

export interface KLineData {
  id:              string;
  type:            KLineType;
  created_at:      number;
  situation_desc:  string;
  frame_id:        string | null;
  bands:           Record<BandName, KLineBandData>;
  guard:           KLineGuardData | null;
  task_id:         string | null;
  retrieval_count: number;
  embedding:       number[];
  embedding_model: string;
}

export interface ScoredKLine {
  kline: KLineData;
  score: number;
}

// ─── Raw DB row ───────────────────────────────────────────────────────────────

interface RawRow {
  id:              string;
  type:            string;
  created_at:      number;
  situation_desc:  string;
  frame_id:        string | null;
  bands:           string;
  guard:           string | null;
  task_id:         string | null;
  retrieval_count: number;
  embedding:       string;
  embedding_model: string;
}

function rowToKLine(row: RawRow): KLineData {
  const bands = JSON.parse(row.bands) as Record<BandName, KLineBandData>;
  return {
    id:              row.id,
    type:            row.type as KLineType,
    created_at:      row.created_at,
    situation_desc:  row.situation_desc,
    frame_id:        row.frame_id,
    bands,
    guard:           row.guard ? JSON.parse(row.guard) as KLineGuardData : null,
    task_id:         row.task_id,
    retrieval_count: row.retrieval_count,
    embedding:       JSON.parse(row.embedding) as number[],
    embedding_model: row.embedding_model,
  };
}

// ─── Inline BagOfWords embedder (mirrors core/kline/embedding.ts) ────────────

const BOW_DIMS = 64;

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1);
}

function tokenToDim(token: string, dims: number): number {
  let h = 5381;
  for (let i = 0; i < token.length; i++) {
    h = ((h << 5) + h + token.charCodeAt(i)) & 0x7fffffff;
  }
  return h % dims;
}

function l2Normalize(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  if (norm === 0) return vec;
  for (let i = 0; i < vec.length; i++) vec[i] /= norm;
  return vec;
}

function bowEmbed(text: string): number[] {
  const tokens = tokenize(text);
  const vec = new Array<number>(BOW_DIMS).fill(0);
  for (const t of tokens) vec[tokenToDim(t, BOW_DIMS)] += 1;
  return l2Normalize(vec);
}

function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return Math.max(-1, Math.min(1, dot));
}

// ─── FTS query sanitizer (matches core/kline/KLineStore.ts) ──────────────────

function sanitizeFts(query: string): string {
  const tokens = query
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
  return tokens.map((t) => `"${t}"`).join(" ");
}

// ─── KLineReader ──────────────────────────────────────────────────────────────

export class KLineReader {
  private readonly db:       Database.Database;
  private readonly listStmt: Database.Statement;
  private readonly byIdStmt: Database.Statement;

  private constructor(db: Database.Database) {
    this.db = db;
    this.listStmt = db.prepare(
      `SELECT id, type, created_at, situation_desc, frame_id, bands, guard,
              task_id, retrieval_count, embedding, embedding_model
       FROM klines ORDER BY created_at DESC LIMIT @limit`,
    );
    this.byIdStmt = db.prepare(
      `SELECT id, type, created_at, situation_desc, frame_id, bands, guard,
              task_id, retrieval_count, embedding, embedding_model
       FROM klines WHERE id = @id`,
    );
  }

  static tryOpen(dbPath = DEFAULT_KLINE_DB_PATH): KLineReader | null {
    if (!existsSync(dbPath)) return null;
    const db = new Database(dbPath, { readonly: true });
    return new KLineReader(db);
  }

  list(limit = 200): KLineData[] {
    const rows = this.listStmt.all({ limit }) as RawRow[];
    return rows.map(rowToKLine);
  }

  getById(id: string): KLineData | null {
    const row = this.byIdStmt.get({ id }) as RawRow | undefined;
    return row ? rowToKLine(row) : null;
  }

  /**
   * Hybrid retrieval: BM25 FTS + cosine similarity.
   * Weights: 70% vector (when dims match), 30% FTS.
   * Returns K-lines with combined score, sorted descending.
   */
  retrieve(queryText: string, opts: { topK?: number; typeFilter?: KLineType } = {}): ScoredKLine[] {
    const { topK = 5, typeFilter } = opts;

    // FTS search
    const safeFts = sanitizeFts(queryText);
    const bm25Map = new Map<string, number>();
    if (safeFts) {
      const typeClause = typeFilter
        ? `AND k.type = '${typeFilter.replace(/'/g, "''")}'`
        : "";
      try {
        const ftsRows = this.db.prepare(`
          SELECT f.kline_id, f.rank
          FROM klines_fts f
          JOIN klines k ON k.id = f.kline_id
          WHERE klines_fts MATCH @query ${typeClause}
          ORDER BY f.rank LIMIT 50
        `).all({ query: safeFts }) as Array<{ kline_id: string; rank: number }>;
        for (const r of ftsRows) bm25Map.set(r.kline_id, r.rank);
      } catch {
        // FTS may not exist on older DBs — continue with vector only
      }
    }

    // Load candidates
    const typeWhere = typeFilter ? `WHERE type = '${typeFilter.replace(/'/g, "''")}'` : "";
    const candidates = this.db.prepare(
      `SELECT id, type, created_at, situation_desc, frame_id, bands, guard,
              task_id, retrieval_count, embedding, embedding_model
       FROM klines ${typeWhere} ORDER BY created_at DESC LIMIT 200`,
    ).all() as RawRow[];

    // Embed query
    const queryVec = bowEmbed(queryText);

    // Score
    const scored: ScoredKLine[] = [];
    for (const row of candidates) {
      const kline = rowToKLine(row);

      // Vector similarity (only when dims match)
      const vecSim = kline.embedding.length === BOW_DIMS
        ? Math.max(0, cosine(queryVec, kline.embedding))
        : 0;

      // FTS contribution
      const bm25 = bm25Map.get(kline.id) ?? null;
      const fts  = bm25 !== null ? 1 / (1 + Math.abs(bm25)) : 0;

      const score = 0.7 * vecSim + 0.3 * fts;
      if (score > 0) scored.push({ kline, score });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  close(): void {
    this.db.close();
  }
}
