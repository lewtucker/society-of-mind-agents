import type { PolynemeBus } from "../polyneme-bus/PolynemeBus.ts";
import type { AgentCapability } from "../agent/types.ts";
import type { AgencyOptions, Connectable } from "./types.ts";

// ─── Capability ordering (cheapest → most expensive) ─────────────────────────

const CAPABILITY_RANK: Record<AgentCapability, number> = {
  deterministic: 0,
  classifier:    1,
  reasoner:      2,
  planner:       3,
  synthesizer:   4,
};

function highestCapability(members: Connectable[]): AgentCapability {
  if (members.length === 0) return "deterministic";
  return members.reduce<AgentCapability>((best, m) => {
    return CAPABILITY_RANK[m.capability] > CAPABILITY_RANK[best]
      ? m.capability
      : best;
  }, "deterministic");
}

// ─── Agency ──────────────────────────────────────────────────────────────────

/**
 * A group of agents (or nested agencies) presented as a unified capability.
 *
 * Minsky: "An agency is a collection of agents viewed as a single unit."
 *
 * The Agency is a lifecycle manager — it connects and disconnects all members
 * together, emits `agency.active` / `agency.dormant` lifecycle signals, and
 * reports any member connection errors without stopping other members.
 *
 * Members communicate directly via the shared bus (peer-to-peer polyneme
 * fan-out), not through the Agency. The Agency does not intercept or route
 * signals between members.
 *
 * Agencies can be nested: an Agency's members can themselves be Agencies.
 * Connecting a parent connects the full sub-tree recursively.
 */
export class Agency implements Connectable {
  readonly id: string;
  readonly name: string;
  readonly capability: AgentCapability;

  private readonly opts: AgencyOptions;

  constructor(opts: AgencyOptions) {
    this.id         = opts.id;
    this.name       = opts.name;
    this.capability = opts.capability ?? highestCapability(opts.members);
    this.opts       = opts;
  }

  /**
   * Connect all members to the bus, then emit `agency.active`.
   *
   * Member connection errors are caught per-member — a failing member emits
   * `agency.member.error` and the rest connect normally. This mirrors how
   * Agent.connect() isolates errors so a bad agent never kills the bus.
   *
   * Returns a disconnect function. Call it to disconnect all members and
   * emit `agency.dormant`.
   */
  connect(bus: PolynemeBus): () => void {
    const memberIds: string[] = [];
    const disconnects: Array<() => void> = [];

    for (const member of this.opts.members) {
      try {
        const disconnect = member.connect(bus);
        disconnects.push(disconnect);
        memberIds.push(member.id);
      } catch (err) {
        bus.emit({
          source:   this.id,
          signal:   "agency.member.error",
          type:     "activation",
          payload:  { memberId: member.id, error: String(err) },
          causedBy: null,
        });
      }
    }

    bus.emit({
      source:   this.id,
      signal:   "agency.active",
      type:     "activation",
      payload:  {
        name:        this.name,
        memberCount: memberIds.length,
        memberIds,
        capability:  this.capability,
      },
      causedBy: null,
    });

    return () => {
      for (const disconnect of disconnects) {
        disconnect();
      }
      bus.emit({
        source:   this.id,
        signal:   "agency.dormant",
        type:     "activation",
        payload:  { name: this.name },
        causedBy: null,
      });
    };
  }
}
