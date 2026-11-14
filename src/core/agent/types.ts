import type { SignalEnvelope, SignalType } from "../event-log/types.ts";
import type { PolynemeBus } from "../polyneme-bus/PolynemeBus.ts";

export type { SignalEnvelope, SignalType };

export type SocietyMode = "OBSERVE" | "ACT";

/**
 * Capability tier — used by Agency to route to the cheapest capable member.
 * Ordered from least to most expensive.
 */
export type AgentCapability =
  | "deterministic"  // pure code, zero tokens
  | "classifier"     // Haiku — simple yes/no or category decision
  | "reasoner"       // Haiku/Sonnet — multi-step judgment within a domain
  | "planner"        // Sonnet — goal decomposition, ambiguity resolution
  | "synthesizer";   // Opus — cross-domain, creative, high-stakes judgment

// ─── Tool definition (Anthropic-compatible) ───────────────────────────────────

export interface ToolProperty {
  type: string;
  description?: string;
  enum?: string[];
}

export interface Tool {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, ToolProperty>;
    required?: string[];
  };
}

// ─── Agent configuration ──────────────────────────────────────────────────────

/**
 * Context injected into every signal handler — the agent's view of the
 * current society state at the moment it is called.
 */
export interface AgentContext {
  /** Current pronome bindings from the bus (Actor, Goal, Object, …) */
  pronomes: Record<string, string>;
  /** The triggering signal */
  trigger: SignalEnvelope;
  /** The bus — so handlers can emit response signals */
  bus: PolynemeBus;
}

/**
 * What a deterministic handler returns. LLM-backed agents produce this
 * implicitly via tool calls; deterministic agents return it directly.
 */
export interface AgentResponse {
  emit: Array<{
    signal: string;
    type: SignalType;
    payload: Record<string, unknown>;
  }>;
}

export interface AgentOptions {
  /** Stable identifier — used as the bus subscriber id and event source */
  id: string;

  /** Human-readable name (shown in introspection app) */
  name: string;

  /**
   * Defines the agent's specialty, constraints, and role in the society.
   * Injected as the system prompt for LLM-backed agents.
   */
  systemPrompt: string;

  /** Signal name patterns to subscribe to. Supports glob ("block.*") and "*" */
  signals: string[];

  /** Optional: restrict further to specific signal types */
  types?: SignalType[];

  /**
   * Scoped tools available to this agent.
   * In OBSERVE mode, tool calls are intercepted and logged as `tool_intent`
   * signals rather than executed. In ACT mode, they execute (Phase 4+).
   * All agents also have the built-in `emit_signal` tool at no extra config.
   */
  tools?: Tool[];

  /**
   * Deterministic handler — if provided, used instead of an LLM call.
   * Useful for routing agents, demons, arbiters, and tests.
   */
  handler?: (ctx: AgentContext) => AgentResponse | Promise<AgentResponse>;

  /** Claude model to use. Default: claude-haiku-4-5-20251001 (fast, cheap) */
  model?: string;

  /** OBSERVE (default) or ACT */
  mode?: SocietyMode;

  /**
   * Capability tier — describes the reasoning complexity this agent requires.
   * Used by Agency to route signals to the cheapest capable member.
   * Defaults to "deterministic" if handler is provided, "reasoner" otherwise.
   */
  capability?: AgentCapability;
}
