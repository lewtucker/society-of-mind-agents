import type { KLine } from "./types.ts";

// ─── Cosine similarity ────────────────────────────────────────────────────────

/**
 * Cosine similarity between two L2-normalised vectors.
 * Returns a value in [-1, 1]. Returns 0 if either vector is all-zero.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return Math.max(-1, Math.min(1, dot));
}

// ─── Temporal decay ───────────────────────────────────────────────────────────

const MS_PER_DAY = 86_400_000;

/**
 * Apply temporal decay to a relevance score.
 *
 * Formula: score × exp(-ln(2) / halfLifeDays × ageInDays)
 * Matches openclaw's decay implementation.
 *
 * halfLifeDays = 0 means no decay (core K-lines, abstract K-lines).
 */
export function temporalDecay(
  score:        number,
  createdAt:    number,
  halfLifeDays: number,
): number {
  if (halfLifeDays === 0) return score;
  const ageInDays = (Date.now() - createdAt) / MS_PER_DAY;
  return score * Math.exp((-Math.LN2 / halfLifeDays) * ageInDays);
}

/**
 * Effective half-life for a K-line based on its dominant band.
 * Core-heavy K-lines don't decay; fringe-heavy ones decay fast.
 */
export function effectiveHalfLife(kline: KLine): number {
  if (kline.type === "abstract") return 0; // earned stability
  const coreCount = kline.bands.core.agents.length;
  const periCount = kline.bands.peripheral.agents.length;
  const fringeCount = kline.bands.fringe.agents.length;
  const total = coreCount + periCount + fringeCount;
  if (total === 0) return 180; // default
  if (coreCount / total > 0.5)  return 0;   // mostly core → no decay
  if (fringeCount / total > 0.5) return 30;  // mostly fringe → fast decay
  return 180; // mostly peripheral → slow decay
}

// ─── Hybrid score (vector + FTS) ─────────────────────────────────────────────

/**
 * Combine a vector similarity score and a BM25 FTS rank into one score.
 * Weights: 70% vector, 30% FTS (matching KLINE_MEMORY.md §4.1).
 *
 * bm25Rank is negative in SQLite (lower = better) — we invert it.
 */
export function hybridScore(vectorScore: number, bm25Rank: number | null): number {
  const vec = Math.max(0, vectorScore);
  const fts = bm25Rank !== null ? 1 / (1 + Math.abs(bm25Rank)) : 0;
  return 0.7 * vec + 0.3 * fts;
}

// ─── MMR re-ranking ───────────────────────────────────────────────────────────

export interface ScoredKLine {
  kline: KLine;
  score: number;
}

/**
 * Maximal Marginal Relevance — greedy selection that balances relevance
 * against redundancy among already-selected K-lines.
 *
 * MMR score = λ × relevance − (1−λ) × max_similarity_to_selected
 *
 * λ=0.7 (default) biases toward relevance; lower λ increases diversity.
 *
 * Similarity between K-lines is cosine similarity of their embeddings.
 * Falls back to Jaccard on description tokens when embeddings are absent.
 */
export function mmrRerank(
  candidates: ScoredKLine[],
  topK:       number,
  lambda      = 0.7,
): ScoredKLine[] {
  if (candidates.length <= topK) return candidates;

  const selected: ScoredKLine[] = [];
  const remaining = [...candidates];

  while (selected.length < topK && remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const relevance = remaining[i].score;

      // Max similarity to any already-selected K-line
      let maxSim = 0;
      for (const sel of selected) {
        const sim = embeddingSimilarity(remaining[i].kline, sel.kline);
        if (sim > maxSim) maxSim = sim;
      }

      const mmrScore = lambda * relevance - (1 - lambda) * maxSim;
      if (mmrScore > bestScore) {
        bestScore = mmrScore;
        bestIdx = i;
      }
    }

    selected.push(remaining[bestIdx]);
    remaining.splice(bestIdx, 1);
  }

  return selected;
}

function embeddingSimilarity(a: KLine, b: KLine): number {
  if (a.embedding.length > 0 && b.embedding.length === a.embedding.length) {
    return Math.max(0, cosineSimilarity(a.embedding, b.embedding));
  }
  // Fallback: Jaccard on description tokens
  return jaccardSimilarity(a.situation.description, b.situation.description);
}

function jaccardSimilarity(a: string, b: string): number {
  const tokA = new Set(a.toLowerCase().split(/\W+/).filter(Boolean));
  const tokB = new Set(b.toLowerCase().split(/\W+/).filter(Boolean));
  let intersection = 0;
  for (const t of tokA) { if (tokB.has(t)) intersection++; }
  const union = tokA.size + tokB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
