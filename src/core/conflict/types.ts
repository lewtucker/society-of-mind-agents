// ─── Conflict signals ─────────────────────────────────────────────────────────

/**
 * Emitted by any agent that detects it is competing with another agent for
 * the same terminal slot.
 *
 * Minsky §26: "Cross-exclusion is the principle that when two agents compete
 * for the same resource, only one can be active at a time."
 *
 * `priority` is a numeric score — higher value wins cross-exclusion.
 * Ties are broken alphabetically by agent_id (consistent, deterministic).
 */
export interface ConflictPayload {
  agent_id:           string;
  competing_agent_id: string;
  terminal:           string;  // the slot both agents are trying to fill
  priority:           number;  // this agent's priority score
  competing_priority: number;  // competitor's priority score
}

// ─── Internal tracking ────────────────────────────────────────────────────────

/**
 * In-memory record of an ongoing conflict between two agents over a terminal.
 * Keyed by `"${terminal}:${sortedAgentIdA}:${sortedAgentIdB}"` for consistency.
 */
export interface ConflictRecord {
  terminal:  string;
  agent_ids: [string, string];  // always [lower, higher] alphabetically
  rounds:    number;            // how many times this pair has conflicted
}
