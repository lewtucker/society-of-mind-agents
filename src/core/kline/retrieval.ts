import type { EmbeddingProvider } from "./embedding.ts";
import type { KLineStore } from "./KLineStore.ts";
import {
  cosineSimilarity,
  effectiveHalfLife,
  hybridScore,
  mmrRerank,
  temporalDecay,
} from "./similarity.ts";
import type { ScoredKLine } from "./similarity.ts";
import type { KLine, KLineType } from "./types.ts";

// ─── Options ──────────────────────────────────────────────────────────────────

export interface RetrievalOptions {
  /** Maximum K-lines to return after MMR re-ranking. Default: 5 */
  topK?: number;
  /**
   * MMR lambda: 0 = pure diversity, 1 = pure relevance. Default: 0.7.
   * Matches KLINE_MEMORY.md §4.3.
   */
  lambda?: number;
  /** Minimum post-decay hybrid score to include in results. Default: 0.05 */
  minScore?: number;
  /**
   * Maximum K-lines to load as vector candidates before MMR.
   * Larger = more accurate but slower. Default: 200.
   */
  candidateLimit?: number;
  /** If true, increment retrieval_count for returned K-lines. Default: true */
  trackRetrieval?: boolean;
  /** Restrict retrieval to K-lines of a specific type (e.g. "censor"). */
  typeFilter?: KLineType | KLineType[];
}

// ─── KLineRetrievalEngine ─────────────────────────────────────────────────────

/**
 * Hybrid retrieval: vector similarity + BM25 FTS, temporal decay, MMR re-ranking.
 *
 * Minsky: retrieval is re-activating the K-line closest to the current situation.
 * The embedder captures situational similarity; FTS captures keyword overlap;
 * MMR ensures the returned set is diverse (non-redundant).
 *
 * Scoring pipeline (per KLINE_MEMORY.md §4.1–4.3):
 *   1. Embed query text
 *   2. cosine similarity against all K-line embeddings
 *   3. BM25 rank from FTS
 *   4. hybrid = 0.7 × cosine + 0.3 × FTS_score
 *   5. temporal decay (effectiveHalfLife per dominant band)
 *   6. MMR re-ranking for diversity
 */
export class KLineRetrievalEngine {
  constructor(
    private readonly store:    KLineStore,
    private readonly embedder: EmbeddingProvider,
  ) {}

  /**
   * Retrieve the top-K K-lines most relevant to `queryText`.
   *
   * Returns K-lines with their final (decayed, re-ranked) scores.
   * Increments retrieval_count by default (pass trackRetrieval: false to skip).
   */
  async retrieve(
    queryText:     string,
    opts:          RetrievalOptions = {},
  ): Promise<ScoredKLine[]> {
    const {
      topK            = 5,
      lambda          = 0.7,
      minScore        = 0.05,
      candidateLimit  = 200,
      trackRetrieval  = true,
      typeFilter,
    } = opts;

    // 1. Embed query
    const queryVec = await this.embedder.embed(queryText);

    // 2. FTS ranks for query text
    const ftsResults = this.store.searchFtsWithRanks(queryText, candidateLimit);
    const bm25Map    = new Map(ftsResults.map((r) => [r.id, r.rank]));

    // 3. Load candidates (most recent first; BagOfWords vectors are cheap to compare)
    const candidates = this.store.list({ limit: candidateLimit, type: typeFilter });

    // 4. Score each candidate
    const scored: ScoredKLine[] = [];
    for (const kline of candidates) {
      const vecSim  = vectorSim(queryVec, kline);
      const bm25    = bm25Map.get(kline.id) ?? null;
      const hybrid  = hybridScore(vecSim, bm25);
      const halfLife = effectiveHalfLife(kline);
      const decayed  = temporalDecay(hybrid, kline.created_at, halfLife);

      if (decayed >= minScore) {
        scored.push({ kline, score: decayed });
      }
    }

    // 5. Sort, then MMR
    scored.sort((a, b) => b.score - a.score);
    const results = mmrRerank(scored, topK, lambda);

    // 6. Track retrieval
    if (trackRetrieval) {
      for (const { kline } of results) {
        this.store.incrementRetrievalCount(kline.id);
      }
    }

    return results;
  }

  /**
   * Retrieve K-lines similar to an existing K-line (by id).
   * Useful for consolidation and abstraction (Phase 2.3+).
   */
  async retrieveSimilarTo(
    klineId: string,
    opts:    RetrievalOptions = {},
  ): Promise<ScoredKLine[]> {
    const source = this.store.getById(klineId);
    if (!source) return [];
    return this.retrieve(source.situation.description, opts);
  }

  /**
   * Retrieve censor K-lines that match a situation + proposed action.
   *
   * Returns only censor K-lines whose `guard.blocked_action` matches
   * the proposed `action` (case-insensitive substring). Score reflects
   * situational similarity — high score = this situation closely resembles
   * a previously-failed scenario.
   *
   * Used by `CENSOR_CHECK` in the QueryEngine.
   */
  async retrieveCensors(
    situation: string,
    action:    string,
    opts:      Omit<RetrievalOptions, "typeFilter"> = {},
  ): Promise<ScoredKLine[]> {
    const all = await this.retrieve(situation, {
      ...opts,
      typeFilter:     "censor",
      trackRetrieval: false,
      topK:           opts.topK ?? 10,
    });

    // Filter to censors whose blocked_action matches the proposed action
    const proposed = action.toLowerCase().trim();
    return all.filter(({ kline }) => {
      if (!kline.guard) return false;
      const blocked = kline.guard.blocked_action.toLowerCase().trim();
      return blocked === proposed || proposed.includes(blocked) || blocked.includes(proposed);
    });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function vectorSim(queryVec: number[], kline: KLine): number {
  if (kline.embedding.length !== queryVec.length || kline.embedding.length === 0) {
    return 0;
  }
  return Math.max(0, cosineSimilarity(queryVec, kline.embedding));
}
