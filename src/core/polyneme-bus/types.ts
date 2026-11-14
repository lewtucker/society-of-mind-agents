import type { EmitInput, SignalEnvelope, SignalType } from "../event-log/index.ts";

export type { EmitInput, SignalEnvelope, SignalType };

/**
 * A subscription registration.
 *
 * A subscriber matches events where ALL provided filters pass:
 *   - signals: exact name OR glob ending in ".*"  (absent = match all)
 *   - types:   one of the listed SignalTypes       (absent = match all)
 *   - sources: one of the listed agent ids         (absent = match all)
 *
 * Isonomes always fan out to every subscriber regardless of filters.
 */
export interface SubscribeOptions {
  /** Stable identifier for this subscriber (typically the agent's id). */
  id: string;

  /** Signal name patterns to match. Supports exact ("block.found") and
   *  prefix glob ("block.*"). Omit to match all signal names. */
  signals?: string[];

  /** Signal types to match. Omit to match all types. */
  types?: SignalType[];

  /** Source agent ids to match. Omit to match signals from any agent. */
  sources?: string[];

  /** Called for each matching event. Invoked asynchronously (next microtask)
   *  so emit() never blocks on subscriber work. */
  onSignal: (envelope: SignalEnvelope) => void;
}

export interface Subscription {
  id: string;
  unsubscribe: () => void;
}

/** Current pronome bindings — role → agentId */
export type Pronomes = Record<string, string>;
