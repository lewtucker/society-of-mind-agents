import { Agent } from "../agent/Agent.ts";
import type { AgentContext, AgentOptions, AgentResponse } from "../agent/types.ts";

// ─── Options ──────────────────────────────────────────────────────────────────

export interface BBrainOptions {
  /**
   * Number of occurrences of the same signal from the same source within
   * `loopWindow` ms before `bbrain.loop.detected` fires. Default: 5.
   * The spec says "> 5 times", so the default threshold fires on the 6th.
   */
  loopThreshold?: number;

  /** Window in ms for loop detection. Default: 10_000 */
  loopWindow?: number;

  /**
   * Number of `agent.error` signals within `errorBurstWindow` ms before
   * `bbrain.error.burst` fires. Default: 3 (fires on the 4th).
   */
  errorBurstThreshold?: number;

  /** Window in ms for error burst detection. Default: 5_000 */
  errorBurstWindow?: number;

  /**
   * Number of `agent.conflict` rounds for the same (terminal, agent pair)
   * before `bbrain.conflict.spiral` fires. Default: 3.
   */
  spiralThreshold?: number;

  /**
   * Duration in ms of signal silence (while a goal is active) before
   * `bbrain.stall.detected` fires. Default: 30_000.
   */
  stallWindow?: number;

  /**
   * How often the stall checker runs in ms. Default: 5_000.
   * Set lower for tests.
   */
  stallCheckInterval?: number;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create the B-Brain observer agent.
 *
 * Minsky §6: "A B-brain is a second-order mind that watches the A-brain,
 * without itself participating in the domain activity. It has no concern
 * with the subject matter of the A-brain — only with how the A-brain behaves."
 *
 * The B-Brain subscribes to ALL signals and detects four meta-level problems:
 *
 *   Loop detection    — same signal from same source fires > loopThreshold
 *                       times within loopWindow ms
 *                       → `bbrain.loop.detected`
 *
 *   Error burst       — more than errorBurstThreshold `agent.error` signals
 *                       within errorBurstWindow ms
 *                       → `bbrain.error.burst`
 *
 *   Conflict spiral   — same two agents fighting over the same terminal for
 *                       more than spiralThreshold rounds
 *                       → `bbrain.conflict.spiral`
 *
 *   Stall             — no signals for longer than stallWindow ms while at
 *                       least one goal is active
 *                       → `bbrain.stall.detected`
 *
 * The B-Brain NEVER emits action signals. Its source is always "b-brain".
 * All emitted signals use the prefix `bbrain.*`.
 * The A-brain is not required to respond to any B-Brain signal.
 */
export function createBBrain(opts: BBrainOptions = {}): Agent {
  const loopThreshold       = opts.loopThreshold       ?? 5;
  const loopWindowMs        = opts.loopWindow           ?? 10_000;
  const errorBurstThreshold = opts.errorBurstThreshold  ?? 3;
  const errorBurstWindowMs  = opts.errorBurstWindow     ?? 5_000;
  const spiralThreshold     = opts.spiralThreshold      ?? 3;
  const stallWindowMs       = opts.stallWindow          ?? 30_000;
  const stallCheckMs        = opts.stallCheckInterval   ?? 5_000;

  // ── State (isolated per agent instance) ───────────────────────────────────

  // Loop detection: signal:source → sorted array of timestamps
  const loopTimes  = new Map<string, number[]>();
  const loopFired  = new Set<string>(); // keys that have already fired this window

  // Error burst: timestamps of recent agent.error signals
  const errorTimes:    number[] = [];
  let   errorBurstFired = false;

  // Conflict spiral: "terminal:agentA:agentB" → round count
  const spiralCounts = new Map<string, number>();

  // Stall detection
  let lastSignalTime  = Date.now();
  let activeGoals     = 0;
  let stallFired      = false;

  // Stall timer — started on first handler call, runs for agent lifetime
  let stallTimer: ReturnType<typeof setInterval> | null = null;

  // ── Agent options ──────────────────────────────────────────────────────────

  const agentOpts: AgentOptions = {
    id:           "b-brain",
    name:         "B-Brain Observer",
    systemPrompt: "Observes the society for meta-level problems without participating in domain activity.",
    signals:      ["*"],
    capability:   "deterministic",

    handler: (ctx: AgentContext): AgentResponse => {
      const { signal, source, type, payload } = ctx.trigger;
      const now = Date.now();

      // B-Brain never processes its own observation signals — prevents
      // self-triggering and keeps its signals out of all detection counts
      if (signal.startsWith("bbrain.")) return { emit: [] };

      // Lifecycle signals (agent.active, agent.dormant) are excluded from
      // loop detection — they fire once per connect and are not loops
      const countForLoop = type !== "activation" && type !== "pronome-bind";

      // Update stall clock on every non-bbrain signal
      lastSignalTime = now;
      stallFired     = false;

      // Start stall monitor on first signal we see
      if (!stallTimer) {
        stallTimer = setInterval(() => {
          if (
            activeGoals > 0 &&
            Date.now() - lastSignalTime >= stallWindowMs &&
            !stallFired
          ) {
            stallFired = true;
            try {
              ctx.bus.emit({
                source:   "b-brain",
                signal:   "bbrain.stall.detected",
                type:     "polyneme",
                payload:  { idle_ms: Date.now() - lastSignalTime, active_goals: activeGoals },
                context:  { pronomes: {}, frame_id: null, kline_ids: [], micronemes: [] },
                causedBy: null,
              });
            } catch {
              // Bus was closed — agent is no longer live; stop the timer
              clearInterval(stallTimer!);
              stallTimer = null;
            }
          }
        }, stallCheckMs);
        // Don't hold the Node.js event loop open — the timer is a background
        // observer and should not prevent process/test exit
        stallTimer.unref();
      }

      const emits: AgentResponse["emit"] = [];

      // ── Goal tracking (for stall detection) ─────────────────────────────
      if (signal === "goal.set")                              activeGoals++;
      if (signal === "goal.achieved" || signal === "goal.failed")
        activeGoals = Math.max(0, activeGoals - 1);

      // ── Loop detection ───────────────────────────────────────────────────
      if (countForLoop) {
        const loopKey = `${signal}:${source}`;
        const times   = loopTimes.get(loopKey) ?? [];
        times.push(now);
        const pruned  = times.filter((t) => now - t <= loopWindowMs);
        loopTimes.set(loopKey, pruned);

        if (pruned.length > loopThreshold && !loopFired.has(loopKey)) {
          loopFired.add(loopKey);
          // Allow re-detection after 2× the window
          setTimeout(() => loopFired.delete(loopKey), loopWindowMs * 2);
          emits.push({
            signal:  "bbrain.loop.detected",
            type:    "polyneme" as const,
            payload: { signal, source, count: pruned.length, window_ms: loopWindowMs },
          });
        }
      }

      // ── Error burst ──────────────────────────────────────────────────────
      if (signal === "agent.error") {
        errorTimes.push(now);
        const recent = errorTimes.filter((t) => now - t <= errorBurstWindowMs);
        errorTimes.length = 0;
        errorTimes.push(...recent);

        if (recent.length > errorBurstThreshold && !errorBurstFired) {
          errorBurstFired = true;
          setTimeout(() => { errorBurstFired = false; }, errorBurstWindowMs);
          emits.push({
            signal:  "bbrain.error.burst",
            type:    "polyneme" as const,
            payload: { count: recent.length, window_ms: errorBurstWindowMs, source },
          });
        }
      }

      // ── Conflict spiral ──────────────────────────────────────────────────
      if (signal === "agent.conflict") {
        const { agent_id, competing_agent_id, terminal } =
          payload as Record<string, unknown>;

        if (
          typeof agent_id           === "string" &&
          typeof competing_agent_id === "string" &&
          typeof terminal           === "string"
        ) {
          const [a, b] = [agent_id, competing_agent_id].sort();
          const key    = `${terminal}:${a}:${b}`;
          const rounds = (spiralCounts.get(key) ?? 0) + 1;
          spiralCounts.set(key, rounds);

          if (rounds > spiralThreshold) {
            spiralCounts.delete(key);
            emits.push({
              signal:  "bbrain.conflict.spiral",
              type:    "polyneme" as const,
              payload: { terminal, agent_ids: [a, b], rounds },
            });
          }
        }
      }

      return { emit: emits };
    },
  };

  return new Agent(agentOpts);
}
