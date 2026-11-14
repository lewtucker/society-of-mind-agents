import type { EventLog } from "../event-log/EventLog.ts";
import type { PolynemeBus } from "../polyneme-bus/PolynemeBus.ts";
import type { Agent } from "../agent/Agent.ts";
import type { KLineRetrievalEngine } from "../kline/retrieval.ts";
import type {
  ActivationQueryResult,
  CausalTraceResult,
  CensorCheckResult,
  MemoryProbeResult,
  QueryInput,
  QueryResult,
  ReasoningProbeResult,
} from "./types.ts";

// Maximum causedBy chain depth before we stop (guards against cycles or corrupt data)
const MAX_CHAIN_DEPTH = 100;

// ─── QueryEngine ──────────────────────────────────────────────────────────────

/**
 * The Query Interface for the Society of Mind.
 *
 * Lets the B-Brain (or an external observer) ask the society questions without
 * triggering action. All queries are read-only — nothing is emitted to the bus.
 *
 * Five query types:
 *   ACTIVATION_QUERY  — which agents are currently active/dormant
 *   CAUSAL_TRACE      — walk the causedBy chain back to a root event
 *   REASONING_PROBE   — dry-run a deterministic agent handler
 *   MEMORY_PROBE      — what K-lines match a situation (stub until Phase 2)
 *   CENSOR_CHECK      — would any censor fire for an action (stub until Phase 2)
 *
 * The QueryEngine is constructed with an EventLog + PolynemeBus (for
 * ACTIVATION_QUERY live state). For REASONING_PROBE, pass the agent directly.
 */
export class QueryEngine {
  constructor(
    private readonly log:      EventLog,
    private readonly bus:      PolynemeBus,
    private readonly retrieval?: KLineRetrievalEngine,
  ) {}

  // ─── Dispatch ──────────────────────────────────────────────────────────────

  async query(input: QueryInput, agent?: Agent): Promise<QueryResult> {
    switch (input.type) {
      case "ACTIVATION_QUERY":
        return this.activationQuery();

      case "CAUSAL_TRACE":
        return this.causalTrace(input.eventId);

      case "REASONING_PROBE":
        if (!agent) throw new Error("REASONING_PROBE requires an agent argument");
        return this.reasoningProbe(agent, input.trigger);

      case "MEMORY_PROBE":
        return await this.memoryProbe(input.situation);

      case "CENSOR_CHECK":
        return await this.censorCheck(input.agentId, input.action, input.situation);
    }
  }

  // ─── ACTIVATION_QUERY ─────────────────────────────────────────────────────

  /**
   * Return the current state of every agent and agency the log knows about.
   * Derives state from the most-recent activation signal per source.
   */
  activationQuery(): ActivationQueryResult {
    const rows = this.log.getActivationStates();
    const agents = rows.map(({ source, signal }) => ({
      id:    source,
      state: (signal === "agent.active" || signal === "agency.active")
        ? "active" as const
        : "dormant" as const,
    }));
    return { type: "ACTIVATION_QUERY", agents };
  }

  // ─── CAUSAL_TRACE ─────────────────────────────────────────────────────────

  /**
   * Walk the causedBy chain from `eventId` back to the root.
   * Returns events ordered root-first (oldest → queried event).
   *
   * `complete: true` means the chain ends at a root event (causedBy null).
   * `complete: false` means a link was missing from the log.
   */
  causalTrace(eventId: string): CausalTraceResult {
    const chain = [];
    let currentId: string | null = eventId;
    let complete = false;

    for (let depth = 0; depth < MAX_CHAIN_DEPTH; depth++) {
      if (!currentId) { complete = true; break; }
      const event = this.log.getById(currentId);
      if (!event) break;
      chain.unshift(event); // prepend → root ends up first
      currentId = event.causedBy;
    }

    return { type: "CAUSAL_TRACE", chain, eventId, complete };
  }

  // ─── REASONING_PROBE ──────────────────────────────────────────────────────

  /**
   * Dry-run the agent's deterministic handler. Does not emit anything.
   * Returns what the agent would emit given the trigger and current pronomes.
   *
   * For LLM-backed agents (no handler), returns an empty stub — those require
   * a real API call which is out of scope for a dry-run query.
   */
  async reasoningProbe(agent: Agent, trigger: import("../event-log/types.ts").SignalEnvelope): Promise<ReasoningProbeResult> {
    const pronomes = this.bus.getPronomes();
    const result = agent.probe(trigger, pronomes);

    if (!result) {
      return {
        type:       "REASONING_PROBE",
        agentId:    agent.id,
        wouldEmit:  [],
        stub:       true,
      };
    }

    const response = await result;
    return {
      type:      "REASONING_PROBE",
      agentId:   agent.id,
      wouldEmit: response.emit,
      stub:      false,
    };
  }

  // ─── MEMORY_PROBE ─────────────────────────────────────────────────────────

  /**
   * Retrieve K-lines that match the given situation description.
   * If the QueryEngine was constructed with a KLineRetrievalEngine, performs
   * real hybrid vector+FTS retrieval. Otherwise returns an empty stub.
   */
  async memoryProbe(situation: string): Promise<MemoryProbeResult> {
    if (!this.retrieval) {
      return { type: "MEMORY_PROBE", situation, klines: [], stub: true };
    }
    const klines = await this.retrieval.retrieve(situation, { trackRetrieval: false });
    return { type: "MEMORY_PROBE", situation, klines, stub: false };
  }

  // ─── CENSOR_CHECK ─────────────────────────────────────────────────────────

  /**
   * Check whether any censor K-line would fire for the proposed action in the
   * given situation. Returns `wouldFire: true` if a matching censor is found.
   *
   * If no KLineRetrievalEngine is present, returns an empty stub.
   */
  async censorCheck(agentId: string, action: string, situation: string): Promise<CensorCheckResult> {
    if (!this.retrieval) {
      return { type: "CENSOR_CHECK", agentId, action, wouldFire: false, matchingCensors: [], stub: true };
    }
    const matchingCensors = await this.retrieval.retrieveCensors(situation, action, { minScore: 0.1 });
    return {
      type: "CENSOR_CHECK",
      agentId,
      action,
      wouldFire: matchingCensors.length > 0,
      matchingCensors,
      stub: false,
    };
  }
}
