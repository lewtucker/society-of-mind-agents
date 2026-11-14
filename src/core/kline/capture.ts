import type { EventLog } from "../event-log/EventLog.ts";
import type { SignalEnvelope } from "../event-log/types.ts";
import { Agent } from "../agent/Agent.ts";
import type { AgentContext, AgentOptions } from "../agent/types.ts";
import type { EmbeddingProvider } from "./embedding.ts";
import { hashText } from "./embedding.ts";
import type { KLineStore } from "./KLineStore.ts";
import type { AgentActivation, BandName, KLineBands, KLineSituation } from "./types.ts";
import { emptyBands } from "./types.ts";

// ─── Band classification ───────────────────────────────────────────────────────

const MAX_CHAIN_DEPTH = 100;

/**
 * Walk the causedBy chain from a trigger event and collect all ancestor events.
 * Returns events in causal order (direct cause first, root last).
 */
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

/**
 * Classify agents from a causal chain into core / peripheral / fringe bands.
 *
 * Level-banding rules (Minsky §17.6):
 *   Core       — agents that appear ≥2× in the causal chain (they were the
 *                critical contributors), or that emitted the task.succeeded signal
 *   Peripheral — agents that appear exactly once in the direct chain
 *   Fringe     — agents mentioned in surrounding context but not in the chain
 *                (e.g. kline_ids context, pronome bindings at time of success)
 *
 * Confidence scores:
 *   Core:       1.0
 *   Peripheral: 0.7
 *   Fringe:     0.2
 */
function classifyAgents(
  trigger: SignalEnvelope,
  chain: SignalEnvelope[],
): { activations: AgentActivation[]; bands: KLineBands } {
  // Count appearances in the direct causal chain
  const chainCount = new Map<string, number>();
  const signalIds  = new Map<string, string[]>(); // agentId → event IDs they produced

  // The trigger emitter is always core
  chainCount.set(trigger.source, (chainCount.get(trigger.source) ?? 0) + 2);
  signalIds.set(trigger.source, [trigger.id]);

  for (const evt of chain) {
    chainCount.set(evt.source, (chainCount.get(evt.source) ?? 0) + 1);
    const ids = signalIds.get(evt.source) ?? [];
    ids.push(evt.id);
    signalIds.set(evt.source, ids);
  }

  // Collect fringe agents from pronome bindings that didn't appear in chain
  const fringeSet = new Set<string>();
  const allSources = new Set([trigger, ...chain].map((e) => e.source));

  // Include pronome-bound agents not already in chain
  const pronomes = trigger.context.pronomes;
  for (const agentId of Object.values(pronomes)) {
    if (!allSources.has(agentId)) {
      fringeSet.add(agentId);
    }
  }

  const bands = emptyBands();
  const activations: AgentActivation[] = [];

  for (const [agentId, count] of chainCount.entries()) {
    let band: BandName;
    let confidence: number;

    if (count >= 2) {
      band = "core";
      confidence = 1.0;
    } else {
      band = "peripheral";
      confidence = 0.7;
    }

    bands[band].agents.push(agentId);
    activations.push({
      agent_id:   agentId,
      agent_type: "unknown",     // agent type not tracked in signals; enriched in Phase 3
      role:       findRole(agentId, pronomes),
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
      role:       findRole(agentId, pronomes),
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

// ─── Situation description builder ────────────────────────────────────────────

/**
 * Build a human-readable situation description from the trigger event.
 * This is the text that gets embedded for similarity retrieval.
 *
 * Uses the task_description payload field if present; falls back to
 * constructing a description from pronomes and frame_id.
 */
function buildDescription(trigger: SignalEnvelope, chain: SignalEnvelope[]): string {
  // Prefer an explicit description from the payload
  if (typeof trigger.payload.description === "string") {
    return trigger.payload.description;
  }
  if (typeof trigger.payload.task_description === "string") {
    return trigger.payload.task_description;
  }

  // Build from context
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

  // Include signal names from the chain for richer vocabulary
  const signals = [...new Set(chain.slice(0, 5).map((e) => e.signal))];
  if (signals.length > 0) {
    parts.push(`Signals: ${signals.join(", ")}`);
  }

  // Include the trigger signal itself
  parts.push(`Outcome: ${trigger.signal}`);

  return parts.join(". ");
}

// ─── Main capture function ────────────────────────────────────────────────────

export interface CaptureResult {
  klineId: string;
  situation: KLineSituation;
  activationCount: number;
}

/**
 * Capture a positive K-line from a task.succeeded (or similar) signal.
 *
 * Steps:
 *   1. Walk the causedBy chain to find all contributing events
 *   2. Classify agents into core / peripheral / fringe bands
 *   3. Build a situation description
 *   4. Embed the description (deterministic BagOfWords or real embedder)
 *   5. Write the K-line to the store
 */
export async function capturePositiveKLine(
  trigger:  SignalEnvelope,
  log:      EventLog,
  store:    KLineStore,
  embedder: EmbeddingProvider,
): Promise<CaptureResult> {
  // 1. Walk causal chain
  const chain = walkCausalChain(trigger, log);

  // 2. Classify agents into bands
  const { activations, bands } = classifyAgents(trigger, chain);

  // 3. Build situation description
  const description = buildDescription(trigger, chain);

  // 4. Embed
  const embedding = await embedder.embed(description);
  const embeddingHash = hashText(description);

  // 5. Build situation context
  const situation: KLineSituation = {
    description,
    frame_id:   trigger.context.frame_id,
    pronomes:   trigger.context.pronomes,
    micronemes: trigger.context.micronemes,
    realm:      Array.isArray(trigger.payload.realm) ? trigger.payload.realm as string[] : [],
  };

  // 6. Collect all source event IDs from the chain
  const sourceEvents = [trigger.id, ...chain.map((e) => e.id)];

  // 7. Write K-line
  const klineId = store.write({
    type: "positive",
    situation,
    activations,
    bands,
    guard:           null,
    parent_id:       typeof trigger.payload.parent_kline_id === "string"
                       ? trigger.payload.parent_kline_id
                       : null,
    source_events:   sourceEvents,
    task_id:         typeof trigger.payload.task_id === "string"
                       ? trigger.payload.task_id
                       : null,
    embedding,
    embedding_model: embedder.modelName,
    embedding_hash:  embeddingHash,
  });

  return { klineId, situation, activationCount: activations.length };
}

// ─── MemoryCaptureAgent factory ───────────────────────────────────────────────

/**
 * Create a deterministic Agent that listens for task.succeeded signals and
 * captures a positive K-line for each success.
 *
 * The agent closes over the EventLog, KLineStore, and EmbeddingProvider —
 * this is the only agent in the system with write access to the K-line store.
 * All other agents (including the introspection app) use read-only access.
 *
 * Emits:
 *   kline.captured — { klineId, situationDescription, activationCount }
 *   kline.capture.error — { error } — if capture fails (never kills the bus)
 */
export function createMemoryCaptureAgent(
  log:      EventLog,
  store:    KLineStore,
  embedder: EmbeddingProvider,
  opts:    { signals?: string[] } = {},
): Agent {
  const signals = opts.signals ?? ["task.succeeded"];

  const agentOpts: AgentOptions = {
    id:           "memory-capture-agent",
    name:         "Memory Capture Agent",
    systemPrompt: "Captures positive K-lines when tasks succeed.",
    signals,
    capability:   "deterministic",
    handler: (ctx: AgentContext) => {
      // Kick off async capture; return immediately with no emissions
      // The actual emissions happen asynchronously via bus.emit()
      capturePositiveKLine(ctx.trigger, log, store, embedder)
        .then((result) => {
          ctx.bus.emit({
            source:   "memory-capture-agent",
            signal:   "kline.captured",
            type:     "polyneme",
            payload: {
              klineId:              result.klineId,
              situationDescription: result.situation.description,
              activationCount:      result.activationCount,
            },
            context:  { pronomes: {}, frame_id: null, kline_ids: [result.klineId], micronemes: [] },
            causedBy: ctx.trigger.id,
          });
        })
        .catch((err: unknown) => {
          ctx.bus.emit({
            source:   "memory-capture-agent",
            signal:   "kline.capture.error",
            type:     "polyneme",
            payload:  { error: String(err) },
            context:  { pronomes: {}, frame_id: null, kline_ids: [], micronemes: [] },
            causedBy: ctx.trigger.id,
          });
        });

      // Return synchronously — async work continues in background
      return { emit: [] };
    },
  };

  return new Agent(agentOpts);
}
