import { Agent } from "../agent/Agent.ts";
import type { AgentContext, AgentOptions, AgentResponse } from "../agent/types.ts";
import type { PolynemeBus } from "../polyneme-bus/PolynemeBus.ts";
import type { GoalStore } from "./GoalStore.ts";
import type { Goal, GoalGap, GoalInput } from "./types.ts";

// ─── Core logic ───────────────────────────────────────────────────────────────

/**
 * Detect gaps between desired and current terminal values.
 *
 * Minsky §7: The difference-engine compares current vs. desired state and
 * produces a list of discrepancies — each gap recruits an agent to close it.
 *
 * Comparison is strict (===). A terminal absent from `current` produces a gap
 * with `current: undefined`. Terminals absent from `desired` are unconstrained.
 */
export function detectGaps(
  desired: Record<string, unknown>,
  current: Record<string, unknown>,
): GoalGap[] {
  const gaps: GoalGap[] = [];
  for (const [terminal, desiredVal] of Object.entries(desired)) {
    const currentVal = current[terminal];
    if (currentVal !== desiredVal) {
      gaps.push({ terminal, desired: desiredVal, current: currentVal });
    }
  }
  return gaps;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export interface GoalAgentOptions {
  /**
   * Signal names to subscribe to. Default: ["goal.set", "state.updated", "gap.closed"].
   * Narrowing is rarely needed — the agent only reacts to its three signals.
   */
  signals?: string[];
}

/**
 * Create the GoalAgent — the difference-engine that tracks goals and emits
 * gap/achievement signals.
 *
 * Minsky §7: "A difference-engine is a mechanism that keeps comparing
 * 'what is' with 'what should be', and activates whatever agents it can
 * recruit to reduce the difference."
 *
 * Signal contracts
 * ────────────────
 * Consumed:
 *   goal.set       { goal_id }                            — new goal registered
 *   state.updated  { terminals: Record<string, unknown> } — world state changed
 *   gap.closed     { goal_id, terminal, value }           — agent closed a gap
 *
 * Emitted:
 *   goal.gap       { goal_id, terminal, desired, current } — each open gap
 *   goal.achieved  { goal_id, description }                — all gaps closed
 *
 * Usage:
 *   const agent = createGoalAgent(goalStore);
 *   agent.connect(bus);
 *
 *   // To set a goal, use setGoal() — it writes to the store and emits goal.set
 *   const goalId = setGoal(bus, goalStore, { description: "...", desired: {...} });
 */
export function createGoalAgent(
  goalStore: GoalStore,
  opts:      GoalAgentOptions = {},
): Agent {
  const signals = opts.signals ?? ["goal.set", "state.updated", "gap.closed"];

  // In-memory state — shared across handler invocations via closure
  // Maps goal_id → Goal for all goals the agent is currently tracking
  const activeGoals  = new Map<string, Goal>();
  // Maps terminal_name → current value (global across all goals)
  const currentState = new Map<string, unknown>();

  const agentOpts: AgentOptions = {
    id:           "goal-agent",
    name:         "Goal Agent",
    systemPrompt: "Tracks active goals and detects gaps between desired and current state.",
    signals,
    capability:   "deterministic",

    handler: (ctx: AgentContext): AgentResponse => {
      const { signal, payload } = ctx.trigger;

      // ── goal.set ────────────────────────────────────────────────────────────
      if (signal === "goal.set") {
        const { goal_id } = payload as { goal_id: string };
        const goal = goalStore.getById(goal_id);
        if (!goal || !goal.active) return { emit: [] };

        activeGoals.set(goal_id, goal);

        const current = Object.fromEntries(currentState);
        const gaps    = detectGaps(goal.desired, current);

        if (gaps.length === 0) {
          goalStore.setActive(goal_id, false);
          activeGoals.delete(goal_id);
          return {
            emit: [{
              signal:  "goal.achieved",
              type:    "polyneme" as const,
              payload: { goal_id, description: goal.description },
            }],
          };
        }

        return {
          emit: gaps.map((gap) => ({
            signal:  "goal.gap",
            type:    "polyneme" as const,
            payload: { goal_id, ...gap },
          })),
        };
      }

      // ── state.updated ───────────────────────────────────────────────────────
      if (signal === "state.updated") {
        const { terminals } = payload as { terminals: Record<string, unknown> };
        for (const [k, v] of Object.entries(terminals)) {
          currentState.set(k, v);
        }

        const emits: AgentResponse["emit"] = [];
        const current = Object.fromEntries(currentState);

        for (const [goal_id, goal] of activeGoals) {
          const gaps = detectGaps(goal.desired, current);

          if (gaps.length === 0) {
            goalStore.setActive(goal_id, false);
            activeGoals.delete(goal_id);
            emits.push({
              signal:  "goal.achieved",
              type:    "polyneme" as const,
              payload: { goal_id, description: goal.description },
            });
          } else {
            for (const gap of gaps) {
              emits.push({
                signal:  "goal.gap",
                type:    "polyneme" as const,
                payload: { goal_id, ...gap },
              });
            }
          }
        }

        return { emit: emits };
      }

      // ── gap.closed ──────────────────────────────────────────────────────────
      if (signal === "gap.closed") {
        const { goal_id, terminal, value } = payload as {
          goal_id: string;
          terminal: string;
          value: unknown;
        };

        currentState.set(terminal, value);

        const goal = activeGoals.get(goal_id);
        if (!goal) return { emit: [] };

        const current = Object.fromEntries(currentState);
        const gaps    = detectGaps(goal.desired, current);

        if (gaps.length === 0) {
          goalStore.setActive(goal_id, false);
          activeGoals.delete(goal_id);
          return {
            emit: [{
              signal:  "goal.achieved",
              type:    "polyneme" as const,
              payload: { goal_id, description: goal.description },
            }],
          };
        }

        return {
          emit: gaps.map((gap) => ({
            signal:  "goal.gap",
            type:    "polyneme" as const,
            payload: { goal_id, ...gap },
          })),
        };
      }

      return { emit: [] };
    },
  };

  return new Agent(agentOpts);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Write a goal to the store and emit `goal.set` on the bus.
 *
 * This is the canonical way to register a new goal — it ensures the agent
 * learns about the goal via the bus (keeping the signal log complete) rather
 * than requiring direct coupling to the agent instance.
 *
 * Returns the new goal's ULID.
 */
export function setGoal(
  bus:       PolynemeBus,
  goalStore: GoalStore,
  input:     GoalInput,
): string {
  const goal_id = goalStore.write(input);

  bus.emit({
    source:   "goal-manager",
    signal:   "goal.set",
    type:     "polyneme",
    payload:  { goal_id },
    context:  { pronomes: {}, frame_id: null, kline_ids: [], micronemes: [] },
    causedBy: null,
  });

  return goal_id;
}
