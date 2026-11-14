import type { SignalContext } from "../event-log/types.ts";

// ─── ContextStore ─────────────────────────────────────────────────────────────

/**
 * The shared context state for one running society task.
 *
 * Minsky concepts housed here:
 *   - Pronomes    — temporary role bindings (Actor, Goal, Object, …)
 *   - Frame ref   — which knowledge template is currently active
 *   - K-line refs — which memories influenced the current state (set by MemoryManager, Phase 2)
 *   - Micronemes  — contextual embedding vector shading interpretation (Phase 2)
 *
 * ContextStore is *state only* — no bus dependency, no event emission.
 * PolynemeBus owns event emission; it delegates state reads/writes here and
 * emits audit events (pronome.bind, pronome.release) itself.
 *
 * Every signal emitted by PolynemeBus.emit() carries a snapshot of this store
 * in its `context` field, so every event in the audit trail reflects the full
 * societal context at the moment it was emitted.
 *
 * Injectable for testing: construct a ContextStore directly without a bus.
 */
export class ContextStore {
  private pronomes: Record<string, string> = {};
  private frameId: string | null = null;
  private klineIds: string[] = [];
  private micronemes: number[] = [];

  // ─── Pronomes ───────────────────────────────────────────────────────────────

  /** Bind a role to an agent id. e.g. bind("Actor", "grasp-agent-01") */
  bind(role: string, agentId: string): void {
    this.pronomes[role] = agentId;
  }

  /** Release a pronome binding. No-op if the role is not bound. */
  release(role: string): void {
    delete this.pronomes[role];
  }

  getPronomes(): Readonly<Record<string, string>> {
    return { ...this.pronomes };
  }

  // ─── Active frame ────────────────────────────────────────────────────────────

  /** Set the currently active frame (Phase 3: FrameSelector calls this). */
  setFrame(frameId: string | null): void {
    this.frameId = frameId;
  }

  getFrame(): string | null {
    return this.frameId;
  }

  // ─── Active K-line references ────────────────────────────────────────────────

  /**
   * Set the K-line ids that influenced the current state.
   * Called by MemoryManager after retrieval (Phase 2).
   */
  setActiveKLines(ids: string[]): void {
    this.klineIds = [...ids];
  }

  getActiveKLines(): readonly string[] {
    return this.klineIds;
  }

  // ─── Micronemes ───────────────────────────────────────────────────────────────

  /**
   * Set the contextual embedding vector.
   * Called by MemoryManager to shade interpretation (Phase 2).
   */
  setMicronemes(vec: number[]): void {
    this.micronemes = [...vec];
  }

  getMicronemes(): readonly number[] {
    return this.micronemes;
  }

  // ─── Snapshot ─────────────────────────────────────────────────────────────────

  /**
   * Return a defensive copy of the current context — safe to embed in a
   * SignalEnvelope without the caller mutating internal state.
   */
  snapshot(): SignalContext {
    return {
      pronomes:  { ...this.pronomes },
      frame_id:  this.frameId,
      kline_ids: [...this.klineIds],
      micronemes: [...this.micronemes],
    };
  }
}
