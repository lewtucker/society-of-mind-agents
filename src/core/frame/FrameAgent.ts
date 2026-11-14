import { Agent } from "../agent/Agent.ts";
import type { AgentContext, AgentOptions } from "../agent/types.ts";
import type { KLineRetrievalEngine } from "../kline/retrieval.ts";
import type { ScoredKLine } from "../kline/similarity.ts";
import { FrameMatcher } from "./matcher.ts";
import { fillSlots } from "./slotfiller.ts";
import type { FrameStore } from "./FrameStore.ts";

// ─── Factory ──────────────────────────────────────────────────────────────────

export interface FrameAgentOptions {
  /**
   * Signal name patterns to subscribe to. Default: ["*"] (every signal).
   * Restrict to e.g. ["block.*"] to only match on block signals.
   */
  signals?: string[];

  /**
   * Minimum match score (0–1) to select a frame. Default: 0.05.
   * Lower = more permissive (more frames selected).
   * Higher = only strong matches trigger frame activation.
   */
  minScore?: number;

  /**
   * Optional retrieval engine for K-line-based slot filling.
   * When provided, retrieved K-lines supply terminal values at priority 2
   * (above pronomes and defaults, below explicit payload values).
   */
  retrieval?: KLineRetrievalEngine;
}

/**
 * Create a FrameAgent — the agent responsible for frame selection and
 * slot-filling when signals arrive.
 *
 * Minsky §24: "When a frame is activated, it recruits certain agents to fill
 * its terminal slots; those agents in turn become active."
 *
 * On every matched signal:
 *   1. Run FrameMatcher against all frames in the store
 *   2. If a frame scores above minScore, select it
 *   3. Retrieve K-lines for contextual slot filling (if retrieval provided)
 *   4. Fill all terminals from payload → klines → pronomes → defaults
 *   5. Update ContextStore.frameId via ctx.bus.context.setFrame()
 *   6. Emit `frame.selected` with the filled terminal set
 *
 * Emits:
 *   frame.selected — { frame_id, frame_name, score, complete, terminals }
 */
export function createFrameAgent(
  frameStore: FrameStore,
  opts:       FrameAgentOptions = {},
): Agent {
  const signals  = opts.signals  ?? ["*"];
  const minScore = opts.minScore ?? 0.05;
  const matcher  = new FrameMatcher(frameStore);

  const agentOpts: AgentOptions = {
    id:           "frame-agent",
    name:         "Frame Agent",
    systemPrompt: "Selects and activates the appropriate knowledge frame for each incoming signal.",
    signals,
    capability:   "deterministic",

    handler: async (ctx: AgentContext) => {
      // Skip internal lifecycle signals — they are not knowledge-bearing events
      // and would cause spurious frame activations (e.g. "agent" in a description
      // matches signals like "agent.active").
      if (
        ctx.trigger.type === "activation" ||
        ctx.trigger.type === "pronome-bind" ||
        ctx.trigger.signal === "frame.selected"
      ) {
        return { emit: [] };
      }

      const pronomes = ctx.pronomes;

      // 1. Find best-matching frame
      const best = matcher.best(ctx.trigger, pronomes, minScore);
      if (!best) return { emit: [] };

      // 2. Use inherited terminal set
      const frame = frameStore.getWithInheritance(best.frame.id) ?? best.frame;

      // 3. Optional K-line retrieval for slot filling
      let klines: ScoredKLine[] | undefined;
      if (opts.retrieval) {
        // Build a situation description for retrieval from signal + pronomes
        const desc = buildRetrievalQuery(ctx.trigger.signal, pronomes);
        klines = await opts.retrieval.retrieve(desc, {
          topK:           3,
          trackRetrieval: false,
        });
      }

      // 4. Fill slots
      const filled = fillSlots(frame, {
        payload:  ctx.trigger.payload,
        pronomes,
        klines,
      });

      // 5. Update ContextStore frame
      ctx.bus.context.setFrame(frame.id);

      // 6. Emit frame.selected
      return {
        emit: [{
          signal:  "frame.selected",
          type:    "polyneme" as const,
          payload: {
            frame_id:   frame.id,
            frame_name: frame.name,
            score:      best.score,
            complete:   filled.complete,
            terminals:  serializeTerminals(filled.terminals),
          },
        }],
      };
    },
  };

  return new Agent(agentOpts);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildRetrievalQuery(signal: string, pronomes: Record<string, string>): string {
  const parts = [signal.replace(/[._]/g, " ")];
  for (const [role, id] of Object.entries(pronomes)) {
    parts.push(`${role} ${id}`);
  }
  return parts.join(" ");
}

function serializeTerminals(
  terminals: ReturnType<typeof fillSlots>["terminals"],
): Record<string, { value: unknown; confidence: number; source: string }> {
  return Object.fromEntries(
    Object.entries(terminals).map(([k, v]) => [
      k,
      { value: v.value, confidence: v.confidence, source: v.source },
    ]),
  );
}
