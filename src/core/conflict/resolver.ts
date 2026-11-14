import { Agent } from "../agent/Agent.ts";
import type { AgentContext, AgentOptions, AgentResponse } from "../agent/types.ts";
import type { ConflictPayload, ConflictRecord } from "./types.ts";

// ─── Factory ──────────────────────────────────────────────────────────────────

export interface ConflictResolverOptions {
  /**
   * Number of conflict rounds between the same two agents over the same
   * terminal before noncompromise fires and both are suppressed.
   * Default: 3
   *
   * Minsky §26: "If a prolonged conflict prevents either [agent] from
   * proceeding, it may be better to abandon both and try a different approach."
   */
  noncompromiseThreshold?: number;
}

/**
 * Create the ConflictResolver agent — implements cross-exclusion and
 * noncompromise for competing agents.
 *
 * Minsky §26: Cross-exclusion prevents two agents from simultaneously
 * filling the same terminal. Noncompromise fires when cross-exclusion
 * has failed to resolve a conflict after N rounds — both agents are
 * suppressed so a different agency can attempt the task.
 *
 * Signal contracts
 * ────────────────
 * Consumed:
 *   agent.conflict  { agent_id, competing_agent_id, terminal,
 *                     priority, competing_priority }
 *
 * Emitted (cross-exclusion path):
 *   agent.suppressed  { agent_id, reason: "cross-exclusion",
 *                       terminal, winner_id }
 *
 * Emitted (noncompromise path):
 *   conflict.noncompromise  { terminal, agent_ids, rounds }
 *   agent.suppressed × 2    { agent_id, reason: "noncompromise", terminal }
 */
export function createConflictResolver(
  opts: ConflictResolverOptions = {},
): Agent {
  const threshold = opts.noncompromiseThreshold ?? 3;

  // In-memory conflict tracking: conflictKey → ConflictRecord
  const conflicts = new Map<string, ConflictRecord>();

  const agentOpts: AgentOptions = {
    id:           "conflict-resolver",
    name:         "Conflict Resolver",
    systemPrompt: "Resolves agent conflicts via cross-exclusion and noncompromise.",
    signals:      ["agent.conflict"],
    capability:   "deterministic",

    handler: (ctx: AgentContext): AgentResponse => {
      if (ctx.trigger.signal !== "agent.conflict") return { emit: [] };

      const {
        agent_id,
        competing_agent_id,
        terminal,
        priority,
        competing_priority,
      } = ctx.trigger.payload as ConflictPayload;

      // Build a stable key regardless of which agent emitted the conflict signal
      const [agentA, agentB] = [agent_id, competing_agent_id].sort();
      const key = `${terminal}:${agentA}:${agentB}`;

      // Update or create conflict record
      const record = conflicts.get(key) ?? {
        terminal,
        agent_ids: [agentA, agentB] as [string, string],
        rounds: 0,
      };
      record.rounds += 1;
      conflicts.set(key, record);

      // ── Noncompromise path ────────────────────────────────────────────────
      if (record.rounds >= threshold) {
        conflicts.delete(key);

        return {
          emit: [
            {
              signal:  "conflict.noncompromise",
              type:    "polyneme" as const,
              payload: {
                terminal,
                agent_ids: record.agent_ids,
                rounds:    record.rounds,
              },
            },
            {
              signal:  "agent.suppressed",
              type:    "polyneme" as const,
              payload: {
                agent_id: agentA,
                reason:   "noncompromise",
                terminal,
              },
            },
            {
              signal:  "agent.suppressed",
              type:    "polyneme" as const,
              payload: {
                agent_id: agentB,
                reason:   "noncompromise",
                terminal,
              },
            },
          ],
        };
      }

      // ── Cross-exclusion path ──────────────────────────────────────────────
      // Higher priority wins. Ties broken alphabetically (lower id = winner).
      const winnerId = resolveWinner(
        agent_id,          priority,
        competing_agent_id, competing_priority,
      );
      const loserId = winnerId === agent_id ? competing_agent_id : agent_id;

      return {
        emit: [{
          signal:  "agent.suppressed",
          type:    "polyneme" as const,
          payload: {
            agent_id:  loserId,
            reason:    "cross-exclusion",
            terminal,
            winner_id: winnerId,
          },
        }],
      };
    },
  };

  return new Agent(agentOpts);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns the id of the winning agent.
 * Higher priority wins. Ties broken by alphabetical order (lower id wins —
 * deterministic and consistent regardless of which side emits the conflict).
 */
function resolveWinner(
  agentA:     string,
  priorityA:  number,
  agentB:     string,
  priorityB:  number,
): string {
  if (priorityA !== priorityB) {
    return priorityA > priorityB ? agentA : agentB;
  }
  // Tie: alphabetically lower id wins
  return agentA < agentB ? agentA : agentB;
}
