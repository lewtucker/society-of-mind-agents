import Anthropic from "@anthropic-ai/sdk";
import type { PolynemeBus } from "../polyneme-bus/PolynemeBus.ts";
import type { SignalEnvelope } from "../event-log/types.ts";
import type { AgentCapability, AgentContext, AgentOptions, AgentResponse, Tool } from "./types.ts";

// ─── Built-in tools ───────────────────────────────────────────────────────────

/**
 * Every agent can emit signals. This tool is always present — it is how
 * LLM-backed agents communicate their reasoning back to the society.
 */
const EMIT_SIGNAL_TOOL: Tool = {
  name: "emit_signal",
  description:
    "Emit a signal onto the polyneme bus. Other agents will receive it " +
    "according to their subscriptions. Use this to share findings, request " +
    "action from other agents, or report completion.",
  input_schema: {
    type: "object",
    properties: {
      signal: {
        type: "string",
        description: "Signal name using dot notation, e.g. 'block.found', 'goal.achieved'",
      },
      payload: {
        type: "object",
        description: "Structured data for subscribers",
      },
      summary: {
        type: "string",
        description: "One-line human-readable description (shown in the introspection app)",
      },
    },
    required: ["signal", "payload", "summary"],
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildUserMessage(trigger: SignalEnvelope, pronomes: Record<string, string>): string {
  const parts: string[] = [
    `Signal received: "${trigger.signal}"`,
    `From: ${trigger.source}`,
    `Type: ${trigger.type}`,
  ];

  if (Object.keys(trigger.payload).length > 0) {
    parts.push(`Payload:\n${JSON.stringify(trigger.payload, null, 2)}`);
  }

  const pronomeEntries = Object.entries(pronomes);
  if (pronomeEntries.length > 0) {
    parts.push(`Current role bindings: ${pronomeEntries.map(([r, a]) => `${r}=${a}`).join(", ")}`);
  }

  if (trigger.causedBy) {
    parts.push(`Caused by event: ${trigger.causedBy}`);
  }

  parts.push("\nRespond by calling emit_signal (and any other tools) as needed.");
  return parts.join("\n");
}

// ─── Agent ────────────────────────────────────────────────────────────────────

/**
 * The base class for every agent in the Society of Mind.
 *
 * An agent is activated by incoming polyneme signals. It reasons within its
 * specialty (via LLM or deterministic logic) and emits result signals. It has
 * no knowledge of what other agents are doing — the bus provides all
 * coordination.
 *
 * Two flavors:
 *   - Deterministic: provide `opts.handler` — no LLM call, instant, testable
 *   - LLM-backed:    omit `handler` — invokes Claude with `opts.systemPrompt`
 *
 * In OBSERVE mode (default), domain tool calls are intercepted and logged
 * as `tool_intent` signals rather than executed.
 */
export class Agent {
  readonly id: string;
  readonly name: string;
  readonly capability: AgentCapability;

  private readonly opts: AgentOptions;
  private anthropic: Anthropic | null = null;

  constructor(opts: AgentOptions) {
    this.id         = opts.id;
    this.name       = opts.name;
    this.capability = opts.capability ?? (opts.handler ? "deterministic" : "reasoner");
    this.opts       = opts;
  }

  // ─── Dry-run (REASONING_PROBE) ────────────────────────────────────────────

  /**
   * Run the deterministic handler in dry-run mode — returns what the agent
   * *would* emit without touching the bus or the event log.
   *
   * Returns null for LLM-backed agents (no handler). Calling the LLM is out
   * of scope for a dry-run; use stub mode for those.
   */
  probe(
    trigger: SignalEnvelope,
    pronomes: Record<string, string> = {},
  ): Promise<AgentResponse> | null {
    if (!this.opts.handler) return null;

    // Minimal no-op bus — probe handlers must not emit directly,
    // but we satisfy the type for well-behaved handlers.
    const noopBus = {
      getPronomes: () => pronomes,
    } as unknown as PolynemeBus;

    const ctx: AgentContext = { trigger, pronomes, bus: noopBus };
    return Promise.resolve(this.opts.handler(ctx));
  }

  // ─── Bus integration ───────────────────────────────────────────────────────

  /**
   * Connect to the bus: subscribe to configured signals and announce
   * activation. Returns a disconnect function.
   *
   * In production each agent runs in its own container and this connection
   * happens over IPC/HTTP. In-process is used for Phase 1 development.
   */
  connect(bus: PolynemeBus): () => void {
    const sub = bus.subscribe({
      id:      this.id,
      signals: this.opts.signals,
      types:   this.opts.types,
      onSignal: (envelope) => {
        this.dispatch(envelope, bus).catch((err) => {
          // Never let an agent error kill the bus — report and continue
          bus.emit({
            source:   this.id,
            signal:   "agent.error",
            type:     "activation",
            payload:  { error: String(err), triggeredBy: envelope.id },
            causedBy: envelope.id,
          });
        });
      },
    });

    bus.emit({
      source:   this.id,
      signal:   "agent.active",
      type:     "activation",
      payload:  { name: this.name, signals: this.opts.signals },
      causedBy: null,
    });

    return () => {
      sub.unsubscribe();
      bus.emit({
        source:   this.id,
        signal:   "agent.dormant",
        type:     "activation",
        payload:  { name: this.name },
        causedBy: null,
      });
    };
  }

  // ─── Signal dispatch ───────────────────────────────────────────────────────

  private async dispatch(trigger: SignalEnvelope, bus: PolynemeBus): Promise<void> {
    const ctx: AgentContext = {
      trigger,
      pronomes: bus.getPronomes(),
      bus,
    };

    if (this.opts.handler) {
      const response = await this.opts.handler(ctx);
      this.emitResponse(response, trigger.id, bus);
    } else {
      await this.dispatchLLM(ctx, bus);
    }
  }

  private emitResponse(response: AgentResponse, causedBy: string, bus: PolynemeBus): void {
    for (const e of response.emit) {
      bus.emit({
        source:   this.id,
        signal:   e.signal,
        type:     e.type,
        payload:  e.payload,
        causedBy,
      });
    }
  }

  // ─── LLM dispatch ──────────────────────────────────────────────────────────

  private async dispatchLLM(ctx: AgentContext, bus: PolynemeBus): Promise<void> {
    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      // Stub mode: log intent without calling the API. The infrastructure
      // works end-to-end; only the reasoning step is skipped.
      bus.emit({
        source:   this.id,
        signal:   "agent.stub",
        type:     "activation",
        payload: {
          summary: `[STUB] ${this.name} would process "${ctx.trigger.signal}" — set ANTHROPIC_API_KEY to enable`,
          triggeredBy: ctx.trigger.id,
        },
        causedBy: ctx.trigger.id,
      });
      return;
    }

    if (!this.anthropic) {
      this.anthropic = new Anthropic({ apiKey });
    }

    const tools = [EMIT_SIGNAL_TOOL, ...(this.opts.tools ?? [])];
    const userMessage = buildUserMessage(ctx.trigger, ctx.pronomes);

    const model = this.opts.model ?? "claude-haiku-4-5-20251001";
    const response = await this.anthropic.messages.create({
      model,
      max_tokens: 1024,
      system:     this.opts.systemPrompt,
      messages:   [{ role: "user", content: userMessage }],
      tools,
    });

    bus.emit({
      source:   this.id,
      signal:   "agent.cost",
      type:     "activation",
      payload:  {
        model,
        input_tokens:  response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        triggered_by:  ctx.trigger.id,
      },
      causedBy: ctx.trigger.id,
    });

    for (const block of response.content) {
      if (block.type !== "tool_use") continue;

      if (block.name === "emit_signal") {
        const input = block.input as {
          signal: string;
          payload: Record<string, unknown>;
          summary: string;
        };
        bus.emit({
          source:   this.id,
          signal:   input.signal,
          type:     "polyneme",
          payload:  { ...input.payload, summary: input.summary },
          causedBy: ctx.trigger.id,
        });
      } else {
        // Domain tool call — intercept in OBSERVE mode
        const mode = this.opts.mode ?? "OBSERVE";
        bus.emit({
          source:  this.id,
          signal:  "tool.intent",
          type:    "tool_intent",
          payload: {
            tool:     block.name,
            params:   block.input,
            mode,
            summary:  `[${mode}] ${this.name} → ${block.name}(${JSON.stringify(block.input)})`,
            executed: false, // ACT mode execution: Phase 4
          },
          causedBy: ctx.trigger.id,
        });
      }
    }
  }
}
