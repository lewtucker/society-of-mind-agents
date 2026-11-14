import type { EventLog } from "../event-log/EventLog.ts";
import type { EmitInput, SignalEnvelope } from "../event-log/types.ts";
import type { Pronomes, SubscribeOptions, Subscription } from "./types.ts";
import { ContextStore } from "../context/ContextStore.ts";

// ─── Pattern matching ─────────────────────────────────────────────────────────

/**
 * Returns true if `signal` matches `pattern`.
 * Supports exact match ("block.found") and prefix glob ("block.*").
 * "*" matches everything.
 */
function matchesSignal(pattern: string, signal: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith(".*")) {
    const prefix = pattern.slice(0, -2);
    return signal === prefix || signal.startsWith(prefix + ".");
  }
  return pattern === signal;
}

function matchesSubscriber(opts: SubscribeOptions, envelope: SignalEnvelope): boolean {
  if (opts.signals && !opts.signals.some((p) => matchesSignal(p, envelope.signal))) {
    return false;
  }
  if (opts.types && !opts.types.includes(envelope.type)) {
    return false;
  }
  if (opts.sources && !opts.sources.includes(envelope.source)) {
    return false;
  }
  return true;
}

// ─── PolynemeBus ──────────────────────────────────────────────────────────────

/**
 * The Polyneme Bus — the central nervous system of the Society of Mind.
 *
 * Responsibilities:
 *   1. Accept emit() calls from agents
 *   2. Persist every signal to the EventLog (ground truth / audit trail)
 *   3. Fan out to matching subscribers asynchronously (next microtask)
 *   4. Maintain current pronome bindings (temporary role assignments)
 *   5. Handle isonomes: fan out to ALL subscribers regardless of filters
 *
 * In-process implementation (Phase 0/1): subscribers are callbacks in the
 * same process. Future: subscriber callbacks will be replaced by HTTP calls
 * or IPC writes to agent containers — the interface stays the same.
 */
export class PolynemeBus {
  private readonly log: EventLog;
  private readonly subscribers = new Map<string, SubscribeOptions>();
  readonly context: ContextStore;

  constructor(log: EventLog, context?: ContextStore) {
    this.log     = log;
    this.context = context ?? new ContextStore();
  }

  // ─── Subscription management ───────────────────────────────────────────────

  /**
   * Register a subscriber. Returns a Subscription with an unsubscribe() method.
   * If a subscriber with the same id already exists it is replaced.
   */
  subscribe(opts: SubscribeOptions): Subscription {
    this.subscribers.set(opts.id, opts);
    return {
      id: opts.id,
      unsubscribe: () => this.subscribers.delete(opts.id),
    };
  }

  unsubscribe(id: string): void {
    this.subscribers.delete(id);
  }

  // ─── Emission ──────────────────────────────────────────────────────────────

  /**
   * Emit a signal onto the bus.
   *
   * 1. Injects current pronome bindings into context (if not already set)
   * 2. Persists to EventLog
   * 3. Fans out to matching subscribers (async, next microtask)
   *
   * Returns the assigned event id (ULID).
   */
  emit(input: EmitInput): string {
    // Merge: ContextStore snapshot provides defaults; caller context overrides.
    // Specifics (caller-provided) always win over the shared context state.
    const snap = this.context.snapshot();
    const enriched: EmitInput = {
      ...input,
      context: {
        pronomes:   { ...snap.pronomes,  ...input.context?.pronomes },
        frame_id:   input.context?.frame_id  ?? snap.frame_id,
        kline_ids:  input.context?.kline_ids?.length  ? input.context.kline_ids  : snap.kline_ids,
        micronemes: input.context?.micronemes?.length ? input.context.micronemes : snap.micronemes,
      },
    };

    const id = this.log.emit(enriched);

    // Build the full envelope for fan-out (log assigned the id + timestamp)
    // Re-read from log would be correct but expensive; reconstruct inline.
    const envelope: SignalEnvelope = {
      ...enriched,
      id,
      timestamp: Date.now(),
      context: enriched.context!,
    };

    this.fanOut(envelope);
    return id;
  }

  /**
   * Emit an isonome — a system-wide signal with uniform effect on ALL
   * subscribers, regardless of their filter configuration.
   * Examples: "attention.shift", "mode.change", "society.reset"
   */
  emitIsonome(input: EmitInput): string {
    const snap = this.context.snapshot();
    const id = this.log.emit({ ...input, type: "isonome" });
    const envelope: SignalEnvelope = {
      ...input,
      type: "isonome",
      id,
      timestamp: Date.now(),
      context: {
        pronomes:   { ...snap.pronomes,  ...input.context?.pronomes },
        frame_id:   input.context?.frame_id  ?? snap.frame_id,
        kline_ids:  input.context?.kline_ids?.length  ? input.context.kline_ids  : snap.kline_ids,
        micronemes: input.context?.micronemes?.length ? input.context.micronemes : snap.micronemes,
      },
      causedBy: input.causedBy ?? null,
    };

    // Isonomes bypass filters — deliver to everyone
    for (const opts of this.subscribers.values()) {
      queueMicrotask(() => opts.onSignal(envelope));
    }
    return id;
  }

  // ─── Pronome management ────────────────────────────────────────────────────

  /**
   * Bind a pronome (temporary role → agent assignment).
   * Also emits a "pronome-bind" signal so the binding is in the event log.
   * e.g. bindPronome("Actor", "builder-001")
   */
  bindPronome(role: string, agentId: string, causedBy?: string): void {
    this.context.bind(role, agentId);
    this.emit({
      source:   "bus",
      signal:   "pronome.bind",
      type:     "pronome-bind",
      payload:  { role, agentId },
      causedBy: causedBy ?? null,
    });
  }

  /** Release a pronome binding and log it to the audit trail. */
  releasePronome(role: string, causedBy?: string): void {
    const agentId = this.context.getPronomes()[role] ?? null;
    this.context.release(role);
    this.emit({
      source:   "bus",
      signal:   "pronome.release",
      type:     "pronome-bind",
      payload:  { role, agentId },
      causedBy: causedBy ?? null,
    });
  }

  /** Get all current pronome bindings. */
  getPronomes(): Readonly<Pronomes> {
    return this.context.getPronomes();
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  private fanOut(envelope: SignalEnvelope): void {
    for (const opts of this.subscribers.values()) {
      if (matchesSubscriber(opts, envelope)) {
        // Async delivery: each subscriber is independent; one slow/throwing
        // subscriber must not block others or the emitting agent.
        queueMicrotask(() => {
          try {
            opts.onSignal(envelope);
          } catch (err) {
            // Log and continue — a bad subscriber never kills the bus
            console.error(`[PolynemeBus] subscriber "${opts.id}" threw on "${envelope.signal}":`, err);
          }
        });
      }
    }
  }

  /** Number of active subscribers. */
  get subscriberCount(): number {
    return this.subscribers.size;
  }
}
