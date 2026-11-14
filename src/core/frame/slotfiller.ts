import type { ScoredKLine } from "../kline/similarity.ts";
import type { Frame, Terminal } from "./types.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Where a terminal's value came from. Later in the list = lower priority. */
export type FilledSource = "payload" | "kline" | "pronome" | "default" | "empty";

/**
 * A terminal with its filled value, confidence, and provenance.
 *
 * Minsky §25: "Each terminal can be assigned a default assumption that
 * represents what is most typical or useful in the absence of more specific
 * information." — the `source` field records how specific this fill is.
 */
export interface FilledTerminal {
  name:       string;
  value:      unknown;
  confidence: number;
  source:     FilledSource;
}

/**
 * A frame with all terminals filled from available sources.
 * `complete` is true only when every required terminal has a non-null value.
 */
export interface FilledFrame {
  frame:     Frame;
  terminals: Record<string, FilledTerminal>;
  /** True if every required terminal has a non-null, non-undefined value. */
  complete:  boolean;
}

/**
 * Sources available for slot-filling, in priority order:
 *   payload  — explicit values from the triggering signal (highest confidence)
 *   klines   — values inferred from retrieved K-lines (situational memory)
 *   pronomes — current pronome role bindings (conversational context)
 *   (frame defaults are always tried last)
 */
export interface SlotFillerSources {
  payload:  Record<string, unknown>;
  pronomes: Record<string, string>;
  klines?:  ScoredKLine[];
}

// ─── Slot-filler ──────────────────────────────────────────────────────────────

/**
 * Fill all terminals in `frame` from `sources`.
 *
 * Slot-filling order (specificity wins over defaults):
 *   1. Explicit payload values      (confidence = 1.0)
 *   2. K-line situational memory    (confidence = kline_score × 0.8, capped 0.95)
 *   3. Active pronome bindings      (confidence = 0.7)
 *   4. Frame default values         (confidence = terminal.default_confidence)
 *   5. Empty — no value found       (confidence = 0)
 *
 * Matching is case-insensitive on terminal name.
 * The frame passed in should be the result of `FrameStore.getWithInheritance()`
 * so that inherited terminals are included.
 */
export function fillSlots(frame: Frame, sources: SlotFillerSources): FilledFrame {
  const terminals: Record<string, FilledTerminal> = {};

  for (const [name, terminal] of Object.entries(frame.terminals)) {
    terminals[name] = fillOne(name, terminal, sources);
  }

  const complete = Object.values(frame.terminals)
    .filter((t) => t.required)
    .every((t) => {
      const ft = terminals[t.name];
      return ft !== undefined && ft.value !== null && ft.value !== undefined;
    });

  return { frame, terminals, complete };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function fillOne(
  name:     string,
  terminal: Terminal,
  sources:  SlotFillerSources,
): FilledTerminal {
  const key = name.toLowerCase();

  // 1. Payload
  const payKey = Object.keys(sources.payload).find((k) => k.toLowerCase() === key);
  if (payKey !== undefined && sources.payload[payKey] !== undefined) {
    return { name, value: sources.payload[payKey], confidence: 1.0, source: "payload" };
  }

  // 2. K-lines — check each retrieved K-line's situation.pronomes for this role
  if (sources.klines) {
    for (const { kline, score } of sources.klines) {
      const proKey = Object.keys(kline.situation.pronomes)
        .find((r) => r.toLowerCase() === key);
      if (proKey !== undefined) {
        return {
          name,
          value:      kline.situation.pronomes[proKey],
          confidence: Math.min(score * 0.8, 0.95),
          source:     "kline",
        };
      }
    }
  }

  // 3. Pronome bindings
  const proKey = Object.keys(sources.pronomes).find((r) => r.toLowerCase() === key);
  if (proKey !== undefined) {
    return { name, value: sources.pronomes[proKey], confidence: 0.7, source: "pronome" };
  }

  // 4. Frame default
  if (terminal.default_value !== null && terminal.default_value !== undefined) {
    return {
      name,
      value:      terminal.default_value,
      confidence: terminal.default_confidence,
      source:     "default",
    };
  }

  // 5. Empty
  return { name, value: null, confidence: 0, source: "empty" };
}
