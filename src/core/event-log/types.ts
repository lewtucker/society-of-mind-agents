/**
 * Signal envelope — every event on the polyneme bus is wrapped in this.
 * Matches the schema in ARCHITECTURE.md §3.2.
 */
export interface SignalEnvelope {
  id: string;               // ULID — time-ordered, globally unique
  timestamp: number;        // Unix ms

  source: string;           // AgentId that emitted this signal
  signal: string;           // Polyneme name, e.g. "block.found", "goal.achieved"
  type: SignalType;

  payload: Record<string, unknown>;

  context: SignalContext;

  causedBy: string | null;  // Parent event id — forms the causal chain
}

export type SignalType =
  | "polyneme"      // One-to-many, heterogeneous interpretation per subscriber
  | "isonome"       // System-wide signal with uniform effect on all agencies
  | "activation"    // Agent lifecycle: activated, dormant
  | "pronome-bind"  // Temporary role binding (Actor, Goal, Object…)
  | "censor"        // Censor/suppressor fired
  | "tool_intent";  // Tool call intercepted in OBSERVE mode

export interface SignalContext {
  pronomes: Record<string, string>;  // Current role bindings: { Actor: "agentId", … }
  frame_id: string | null;           // Active frame at time of emission
  kline_ids: string[];               // K-lines that influenced this signal
  micronemes: number[];              // Context embedding vector (optional, can be [])
}

/** Input shape for EventLog.emit() — id and timestamp are assigned by the log */
export type EmitInput = Omit<SignalEnvelope, "id" | "timestamp">;

/** Options for EventLog.tail() */
export interface TailOptions {
  /** Only stream events with id > since (resume from a known position) */
  since?: string;
  /** Called for each new event as it arrives */
  onEvent: (event: SignalEnvelope) => void;
  /** How often to poll for new events, ms. Default: 250 */
  pollMs?: number;
}
