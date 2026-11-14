import { Agent } from "../agent/Agent.ts";
import type { AgentContext, AgentOptions, AgentResponse } from "../agent/types.ts";
import type { KLineRetrievalEngine } from "../kline/retrieval.ts";

// ─── Factory ──────────────────────────────────────────────────────────────────

export interface CensorRegistryOptions {
  /**
   * Minimum retrieval score (0–1) for a censor K-line to trigger a
   * `censor.fired` signal. Default: 0.05 (permissive — censors are cheap
   * to fire and the cost of a false negative is higher than a false positive).
   */
  minScore?: number;
}

/**
 * Create the CensorRegistry agent — the guard that evaluates every tool intent
 * against the censor K-line store before the action is allowed to proceed.
 *
 * Minsky §27: "A censor is a memory of what not to do: when a situation
 * resembles one that previously led to failure, block the action that caused
 * that failure before it has a chance to run."
 *
 * The registry subscribes to all `tool_intent` signals (emitted by agents in
 * OBSERVE mode when they would call a tool). For each intent it:
 *   1. Extracts the proposed action (tool name)
 *   2. Builds a situation description from signal context
 *   3. Queries the K-line store for censor K-lines matching (situation, action)
 *   4. If any match scores above minScore → emits `censor.fired`
 *   5. If no match → silent (action may proceed)
 *
 * Signal contracts
 * ────────────────
 * Consumed:
 *   (any signal, type=tool_intent)
 *     payload: { tool: string; input?: Record<string, unknown> }
 *
 * Emitted:
 *   censor.fired
 *     payload: { action, kline_id, precursor_pattern, blocked_action, score }
 */
export function createCensorRegistry(
  retrieval: KLineRetrievalEngine,
  opts:      CensorRegistryOptions = {},
): Agent {
  const minScore = opts.minScore ?? 0.05;

  const agentOpts: AgentOptions = {
    id:           "censor-registry",
    name:         "Censor Registry",
    systemPrompt: "Evaluates tool intents against censor memories before execution.",
    signals:      ["*"],
    types:        ["tool_intent"],
    capability:   "deterministic",

    handler: (ctx: AgentContext): AgentResponse => {
      // Extract the proposed action (tool name) from the payload
      const action = typeof ctx.trigger.payload.tool === "string"
        ? ctx.trigger.payload.tool
        : ctx.trigger.signal;

      const situation = buildSituation(action, ctx.trigger.signal, ctx.trigger.context);

      // Async: fire-and-forget with direct bus emission on result
      retrieval
        .retrieveCensors(situation, action, { topK: 5 })
        .then((censors) => {
          const match = censors.find((c) => c.score >= minScore);
          if (!match) return;

          ctx.bus.emit({
            source:   "censor-registry",
            signal:   "censor.fired",
            type:     "censor",
            payload:  {
              action,
              kline_id:         match.kline.id,
              precursor_pattern: match.kline.guard?.precursor_pattern ?? "",
              blocked_action:   match.kline.guard?.blocked_action ?? action,
              score:            match.score,
            },
            context:  {
              pronomes:  ctx.trigger.context.pronomes,
              frame_id:  ctx.trigger.context.frame_id,
              kline_ids: [match.kline.id],
              micronemes: [],
            },
            causedBy: ctx.trigger.id,
          });
        })
        .catch(() => {
          // Retrieval errors are non-fatal — silently skip rather than blocking
          // the bus with error signals from a guard agent
        });

      return { emit: [] };
    },
  };

  return new Agent(agentOpts);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a situation description for censor retrieval from the tool_intent
 * signal's context.
 *
 * Mirrors the format used by captureCensorKLine() so that the embedded
 * situation at capture time and the embedded situation at check time are
 * semantically comparable.
 */
/**
 * Build a situation description for censor retrieval.
 *
 * The action (tool name) is the primary signal — it's what the censor's
 * `blocked_action` was written with, so leading with it maximises token
 * overlap in the bag-of-words embedder (and FTS) regardless of context.
 * Context (frame, pronomes) provides secondary situational colour.
 */
function buildSituation(
  action:  string,
  signal:  string,
  context: { frame_id: string | null; pronomes: Record<string, string> },
): string {
  // Tokenise underscores in tool names ("move_block" → "move block")
  const parts: string[] = [action.replace(/_/g, " ")];

  parts.push(signal.replace(/[._]/g, " "));

  if (context.frame_id) {
    parts.push(`Frame: ${context.frame_id}`);
  }

  if (Object.keys(context.pronomes).length > 0) {
    const roles = Object.entries(context.pronomes)
      .map(([role, id]) => `${role}=${id}`)
      .join(", ");
    parts.push(`Pronomes: ${roles}`);
  }

  return parts.join(". ");
}
