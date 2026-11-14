import type { AgentCapability } from "../agent/types.ts";
import type { PolynemeBus } from "../polyneme-bus/PolynemeBus.ts";

// ─── Connectable ─────────────────────────────────────────────────────────────

/**
 * Common interface for anything that can be connected to a bus — Agent or Agency.
 * Enables recursive composition: an Agency's members can themselves be Agencies.
 */
export interface Connectable {
  readonly id: string;
  readonly name: string;
  readonly capability: AgentCapability;
  connect(bus: PolynemeBus): () => void;
}

// ─── Agency configuration ─────────────────────────────────────────────────────

export interface AgencyOptions {
  /** Stable identifier — used as the event source for agency lifecycle signals */
  id: string;

  /** Human-readable name (shown in introspection app) */
  name: string;

  /**
   * Member agents or nested agencies.
   * All share the same bus — they communicate peer-to-peer via polyneme signals.
   * The Agency is a lifecycle manager, not a router.
   */
  members: Connectable[];

  /**
   * Capability tier of this agency as a whole.
   * Defaults to the highest capability tier among its members.
   */
  capability?: AgentCapability;
}
