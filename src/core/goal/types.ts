// ─── Goal ─────────────────────────────────────────────────────────────────────

/**
 * A persistent representation of desired world state.
 *
 * Minsky §7/§8: "A goal is just a description of a desired state of affairs,
 * together with some mechanism that keeps working until that state is achieved."
 *
 * `desired` maps terminal names to their required values.
 * Any terminal absent from `desired` is unconstrained — the goal doesn't care.
 * Values are compared by strict equality (===) against current state.
 *
 * Example: { BlockA_position: "tower-top", BlockB_position: "on-BlockA" }
 * → Both terminals must match before the goal is achieved.
 */
export interface Goal {
  id:          string;   // ULID
  description: string;
  frame_id:    string | null;          // Optional: which frame this goal applies to
  desired:     Record<string, unknown>; // terminal_name → required value
  active:      boolean;                 // false once achieved or failed
  created_at:  number;
  updated_at:  number;
}

/** What callers provide to GoalStore.write() and setGoal(). */
export type GoalInput = Omit<Goal, "id" | "active" | "created_at" | "updated_at">;

// ─── Gap ──────────────────────────────────────────────────────────────────────

/**
 * A single mismatch between desired and current state.
 *
 * Emitted as a `goal.gap` polyneme — agents subscribe to `goal.gap` and
 * activate when they can close their relevant gap.
 */
export interface GoalGap {
  terminal: string;
  desired:  unknown;
  current:  unknown;  // undefined when the terminal has no current value
}
