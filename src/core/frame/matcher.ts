import type { SignalEnvelope } from "../event-log/types.ts";
import type { FrameStore } from "./FrameStore.ts";
import type { Frame } from "./types.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ScoredFrame {
  frame: Frame;
  score: number;
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

/**
 * Score a single frame against an incoming signal.
 *
 * Three components (weights sum to 1.0):
 *
 *   Signal name overlap (0.5) — tokens from the signal name (split on `.`, `-`, `_`)
 *     found in the frame name and description.
 *     "block.found" → tokens ["block", "found"]; "BlockPlacement" → tokens
 *     ["block", "placement"]; overlap = 1/2 = 0.5 → component = 0.25
 *
 *   Payload key overlap (0.3) — fraction of payload keys (case-insensitive)
 *     that match terminal names. High when the signal was designed for this frame.
 *
 *   Pronome role overlap (0.2) — fraction of active pronome roles that match
 *     terminal names. Boosts the frame already active in the current context.
 */
function scoreFrame(
  frame:    Frame,
  signal:   SignalEnvelope,
  pronomes: Record<string, string>,
): number {
  const frameWords = tokenize(`${frame.name} ${frame.description}`);

  // 1. Signal name overlap
  const sigTokens  = signal.signal.split(/[._\-]+/).map((t) => t.toLowerCase()).filter(Boolean);
  const sigOverlap = sigTokens.length > 0
    ? sigTokens.filter((t) => frameWords.has(t)).length / sigTokens.length
    : 0;

  // 2. Payload key overlap against terminal names (case-insensitive)
  const termNames  = new Set(Object.keys(frame.terminals).map((k) => k.toLowerCase()));
  const payKeys    = Object.keys(signal.payload).map((k) => k.toLowerCase());
  const payOverlap = payKeys.length > 0
    ? payKeys.filter((k) => termNames.has(k)).length / payKeys.length
    : 0;

  // 3. Pronome role overlap
  const roles      = Object.keys(pronomes).map((r) => r.toLowerCase());
  const proOverlap = roles.length > 0
    ? roles.filter((r) => termNames.has(r)).length / roles.length
    : 0;

  return 0.5 * sigOverlap + 0.3 * payOverlap + 0.2 * proOverlap;
}

function tokenize(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/\W+/).filter((t) => t.length > 1));
}

// ─── FrameMatcher ─────────────────────────────────────────────────────────────

/**
 * Ranks frames by how well they match an incoming signal.
 *
 * Minsky §24: "A frame is activated when enough of its terminals are
 * recognized in the current situation."
 *
 * Usage:
 *   const matcher = new FrameMatcher(frameStore);
 *   const ranked  = matcher.match(signal, pronomes);
 *   if (ranked.length > 0) console.log(ranked[0].frame.name, ranked[0].score);
 */
export class FrameMatcher {
  constructor(private readonly store: FrameStore) {}

  /**
   * Return all frames with score > 0, sorted by score descending.
   * Caller chooses how many candidates to consider and the minimum threshold.
   */
  match(
    signal:   SignalEnvelope,
    pronomes: Record<string, string>,
    limit     = 200,
  ): ScoredFrame[] {
    const frames  = this.store.list({ limit });
    const results: ScoredFrame[] = [];

    for (const frame of frames) {
      const score = scoreFrame(frame, signal, pronomes);
      if (score > 0) results.push({ frame, score });
    }

    return results.sort((a, b) => b.score - a.score);
  }

  /**
   * Return only the single best-matching frame, or null if nothing scores
   * above `minScore`.
   */
  best(
    signal:   SignalEnvelope,
    pronomes: Record<string, string>,
    minScore  = 0.05,
  ): ScoredFrame | null {
    const ranked = this.match(signal, pronomes);
    if (ranked.length === 0 || ranked[0].score < minScore) return null;
    return ranked[0];
  }
}
