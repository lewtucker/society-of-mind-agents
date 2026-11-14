import type { EventLog } from "../event-log/EventLog.ts";
import type { SignalEnvelope } from "../event-log/types.ts";
import { Agent } from "../agent/Agent.ts";
import type { AgentContext, AgentOptions } from "../agent/types.ts";
import type { EmbeddingProvider } from "./embedding.ts";
import { hashText } from "./embedding.ts";
import type { KLineStore } from "./KLineStore.ts";
import type { AgentActivation, BandName, KLineBands, KLineGuard, KLineSituation } from "./types.ts";
import { emptyBands } from "./types.ts";

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_CHAIN_DEPTH = 100;

// ─── Chain walking (shared pattern with capture.ts) ───────────────────────────

function walkCausalChain(trigger: SignalEnvelope, log: EventLog): SignalEnvelope[] {
  const chain: SignalEnvelope[] = [];
  let current: SignalEnvelope | null = trigger;
  let depth = 0;

  while (current?.causedBy && depth < MAX_CHAIN_DEPTH) {
    const parent = log.getById(current.causedBy);
    if (!parent) break;
    chain.push(parent);
    current = parent;
    depth++;
  }

  return chain;
}

// ─── Guard extraction ─────────────────────────────────────────────────────────

/**
 * Extract the `blocked_action` from the failure event.
 *
 * Priority:
 *   1. `trigger.payload.blocked_action` — explicit field
 *   2. `trigger.payload.action` — also common
 *   3. Last `tool_intent` signal in the causal chain — inferred from the last
 *      attempted tool call before the failure (OBSERVE mode records these)
 *   4. The trigger signal name itself — last resort
 */
function extractBlockedAction(trigger: SignalEnvelope, chain: SignalEnvelope[]): string {
  if (typeof trigger.payload.blocked_action === "string") {
    return trigger.payload.blocked_action;
  }
  if (typeof trigger.payload.action === "string") {
    return trigger.payload.action;
  }

  // Find the most recent tool_intent in the chain (closest to failure)
  for (const evt of chain) {
    if (evt.type === "tool_intent") {
      const toolName = typeof evt.payload.tool === "string" ? evt.payload.tool : null;
      if (toolName) return toolName;
    }
  }

  return trigger.signal;
}

/**
 * Extract or build the `outcome_description` from the failure event.
 */
function extractOutcomeDescription(trigger: SignalEnvelope): string {
  for (const key of ["outcome_description", "reason", "error", "message"] as const) {
    if (typeof trigger.payload[key] === "string") {
      return trigger.payload[key] as string;
    }
  }
  return `Task failed: ${trigger.signal}`;
}

/**
 * Build a precursor pattern — the situation that led to the failure.
 * This is what the censor will match against in future situations.
 */
function buildPrecursorPattern(trigger: SignalEnvelope, chain: SignalEnvelope[]): string {
  if (typeof trigger.payload.precursor_pattern === "string") {
    return trigger.payload.precursor_pattern;
  }

  const parts: string[] = [];

  const frame = trigger.context.frame_id;
  if (frame) parts.push(`Frame: ${frame}`);

  const pronomes = trigger.context.pronomes;
  if (Object.keys(pronomes).length > 0) {
    const roles = Object.entries(pronomes)
      .map(([role, id]) => `${role}=${id}`)
      .join(", ");
    parts.push(`Pronomes: ${roles}`);
  }

  // Include signals leading up to the failure (most recent 3)
  const recentSignals = chain.slice(0, 3).map((e) => e.signal);
  if (recentSignals.length > 0) {
    parts.push(`Prior signals: ${recentSignals.join(" → ")}`);
  }

  parts.push(`Failed on: ${trigger.signal}`);

  return parts.join(". ");
}

// ─── Situation description ────────────────────────────────────────────────────

/**
 * The situation description for a censor K-line is the precursor pattern —
 * this is what gets embedded for similarity retrieval when checking future actions.
 */
function buildDescription(trigger: SignalEnvelope, chain: SignalEnvelope[]): string {
  return buildPrecursorPattern(trigger, chain);
}

// ─── Band classification (adapted for failure context) ────────────────────────

/**
 * For censor K-lines, band classification identifies which agents were
 * involved in the failure — these are the agents to watch for in future.
 *
 * Core:       agent that emitted the failure signal (the proximate cause)
 * Peripheral: agents in the causal chain
 * Fringe:     pronome-bound agents not in the chain
 */
function classifyFailureAgents(
  trigger: SignalEnvelope,
  chain: SignalEnvelope[],
): { activations: AgentActivation[]; bands: KLineBands } {
  const chainCount = new Map<string, number>();
  const signalIds  = new Map<string, string[]>();

  // Failure emitter is the proximate cause — core
  chainCount.set(trigger.source, (chainCount.get(trigger.source) ?? 0) + 2);
  signalIds.set(trigger.source, [trigger.id]);

  for (const evt of chain) {
    chainCount.set(evt.source, (chainCount.get(evt.source) ?? 0) + 1);
    const ids = signalIds.get(evt.source) ?? [];
    ids.push(evt.id);
    signalIds.set(evt.source, ids);
  }

  const fringeSet = new Set<string>();
  const allSources = new Set([trigger, ...chain].map((e) => e.source));
  for (const agentId of Object.values(trigger.context.pronomes)) {
    if (!allSources.has(agentId)) fringeSet.add(agentId);
  }

  const bands = emptyBands();
  const activations: AgentActivation[] = [];

  for (const [agentId, count] of chainCount.entries()) {
    const band: BandName = count >= 2 ? "core" : "peripheral";
    const confidence = band === "core" ? 1.0 : 0.7;
    bands[band].agents.push(agentId);
    activations.push({
      agent_id:   agentId,
      agent_type: "unknown",
      role:       findRole(agentId, trigger.context.pronomes),
      band,
      confidence,
      signal_ids: signalIds.get(agentId) ?? [],
    });
  }

  for (const agentId of fringeSet) {
    bands.fringe.agents.push(agentId);
    activations.push({
      agent_id:   agentId,
      agent_type: "unknown",
      role:       findRole(agentId, trigger.context.pronomes),
      band:       "fringe",
      confidence: 0.2,
      signal_ids: [],
    });
  }

  return { activations, bands };
}

function findRole(agentId: string, pronomes: Record<string, string>): string | null {
  for (const [role, id] of Object.entries(pronomes)) {
    if (id === agentId) return role;
  }
  return null;
}

// ─── Main capture function ────────────────────────────────────────────────────

export interface CensorCaptureResult {
  klineId: string;
  guard: KLineGuard;
  situation: KLineSituation;
}

/**
 * Capture a censor K-line from a task.failed (or similar failure) signal.
 *
 * The censor records:
 *   - The situation (embedded for similarity search)
 *   - The guard: precursor_pattern, blocked_action, outcome_description
 *   - The agents involved (for level-banding awareness)
 *
 * Minsky: "A censor is a K-line that suppresses activity in a certain
 * situation — the result of learning what not to do."
 */
export async function captureCensorKLine(
  trigger:  SignalEnvelope,
  log:      EventLog,
  store:    KLineStore,
  embedder: EmbeddingProvider,
): Promise<CensorCaptureResult> {
  const chain = walkCausalChain(trigger, log);

  const guard: KLineGuard = {
    precursor_pattern:   buildPrecursorPattern(trigger, chain),
    blocked_action:      extractBlockedAction(trigger, chain),
    outcome_description: extractOutcomeDescription(trigger),
  };

  const description = buildDescription(trigger, chain);
  const { activations, bands } = classifyFailureAgents(trigger, chain);

  const embedding      = await embedder.embed(description);
  const embeddingHash  = hashText(description);

  const situation: KLineSituation = {
    description,
    frame_id:   trigger.context.frame_id,
    pronomes:   trigger.context.pronomes,
    micronemes: trigger.context.micronemes,
    realm:      Array.isArray(trigger.payload.realm) ? trigger.payload.realm as string[] : [],
  };

  const sourceEvents = [trigger.id, ...chain.map((e) => e.id)];

  const klineId = store.write({
    type: "censor",
    situation,
    activations,
    bands,
    guard,
    parent_id:       null,
    source_events:   sourceEvents,
    task_id:         typeof trigger.payload.task_id === "string"
                       ? trigger.payload.task_id
                       : null,
    embedding,
    embedding_model: embedder.modelName,
    embedding_hash:  embeddingHash,
  });

  return { klineId, guard, situation };
}

// ─── CensorCaptureAgent factory ───────────────────────────────────────────────

/**
 * Create a deterministic Agent that listens for failure signals and captures
 * a censor K-line for each failure.
 *
 * Default signals: `task.failed`, `agent.error`, `bad_outcome.occurred`
 * These can be overridden via opts.signals.
 *
 * Emits:
 *   censor.captured — { klineId, blockedAction, precursorPattern }
 *   censor.capture.error — { error }
 */
export function createCensorCaptureAgent(
  log:      EventLog,
  store:    KLineStore,
  embedder: EmbeddingProvider,
  opts:    { signals?: string[] } = {},
): Agent {
  const signals = opts.signals ?? ["task.failed", "agent.error", "bad_outcome.occurred"];

  const agentOpts: AgentOptions = {
    id:           "censor-capture-agent",
    name:         "Censor Capture Agent",
    systemPrompt: "Captures censor K-lines when tasks fail.",
    signals,
    capability:   "deterministic",
    handler: (ctx: AgentContext) => {
      captureCensorKLine(ctx.trigger, log, store, embedder)
        .then((result) => {
          ctx.bus.emit({
            source:  "censor-capture-agent",
            signal:  "censor.captured",
            type:    "polyneme",
            payload: {
              klineId:          result.klineId,
              blockedAction:    result.guard.blocked_action,
              precursorPattern: result.guard.precursor_pattern,
            },
            context:  { pronomes: {}, frame_id: null, kline_ids: [result.klineId], micronemes: [] },
            causedBy: ctx.trigger.id,
          });
        })
        .catch((err: unknown) => {
          ctx.bus.emit({
            source:   "censor-capture-agent",
            signal:   "censor.capture.error",
            type:     "polyneme",
            payload:  { error: String(err) },
            context:  { pronomes: {}, frame_id: null, kline_ids: [], micronemes: [] },
            causedBy: ctx.trigger.id,
          });
        });

      return { emit: [] };
    },
  };

  return new Agent(agentOpts);
}
