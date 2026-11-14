import type { SignalEnvelope } from "../event-log/types.ts";
import type { AgentResponse } from "../agent/types.ts";
import type { ScoredKLine } from "../kline/similarity.ts";

// ─── Query inputs ─────────────────────────────────────────────────────────────

export type QueryInput =
  | { type: "ACTIVATION_QUERY" }
  | { type: "CAUSAL_TRACE"; eventId: string }
  | { type: "REASONING_PROBE"; trigger: SignalEnvelope; agentId: string }
  | { type: "MEMORY_PROBE"; situation: string }
  | { type: "CENSOR_CHECK"; agentId: string; action: string; situation: string };

// ─── Query results ────────────────────────────────────────────────────────────

export interface AgentActivationState {
  id: string;
  state: "active" | "dormant";
}

export interface ActivationQueryResult {
  type: "ACTIVATION_QUERY";
  agents: AgentActivationState[];
}

export interface CausalTraceResult {
  type: "CAUSAL_TRACE";
  /** Events ordered root-first (oldest ancestor → queried event). */
  chain: SignalEnvelope[];
  /** The queried event id. */
  eventId: string;
  /** True if the root was found (causedBy null), false if chain was cut (event not found). */
  complete: boolean;
}

export interface ReasoningProbeResult {
  type: "REASONING_PROBE";
  agentId: string;
  /** What the agent would emit. Empty list for LLM-backed agents (stub). */
  wouldEmit: AgentResponse["emit"];
  /** True if the agent has no deterministic handler (LLM-backed). */
  stub: boolean;
}

export interface MemoryProbeResult {
  type: "MEMORY_PROBE";
  situation: string;
  klines: ScoredKLine[];
  stub: boolean;
}

export interface CensorCheckResult {
  type: "CENSOR_CHECK";
  agentId: string;
  action: string;
  wouldFire: boolean;
  matchingCensors: ScoredKLine[];
  stub: boolean;
}

export type QueryResult =
  | ActivationQueryResult
  | CausalTraceResult
  | ReasoningProbeResult
  | MemoryProbeResult
  | CensorCheckResult;
