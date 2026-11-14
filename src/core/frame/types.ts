// ─── Frame type ───────────────────────────────────────────────────────────────

/** Discriminator stored in the DB. "standard" = plain Frame; "trans" = has roles. */
export type FrameType = "standard" | "trans";

// ─── Terminal ─────────────────────────────────────────────────────────────────

/**
 * A named slot in a Frame.
 *
 * Minsky §25: "A frame is a data structure for representing stereotyped
 * situations… with terminals attached to each unit. Each terminal can
 * be assigned a default assumption."
 *
 * Terminals are the slots in the stereotype. They carry a default value
 * (and confidence) that applies unless overridden by explicit information.
 * Lower default_confidence = weaker assumption, more easily displaced.
 */
export interface Terminal {
  name:               string;
  type:               TerminalType;
  default_value:      unknown;       // Value assumed if no filler is provided
  default_confidence: number;        // 0–1: how strongly to hold the default
  required:           boolean;       // True: must be filled for frame to be "active"
}

export type TerminalType = "string" | "number" | "agent_id" | "frame_id" | "any";

// ─── Frame ────────────────────────────────────────────────────────────────────

/**
 * A knowledge template — a stereotype with named slots.
 *
 * Frames pre-fill assumptions (defaults), reducing cognitive load.
 * A `BlockPlacement` frame assumes Actor = grasp-agent, Destination = tower-top
 * until told otherwise. Specifics override weak defaults.
 *
 * Frame inheritance: child frames inherit their parent's terminals.
 * Child definitions shadow parent definitions (child wins on conflict).
 * Use FrameStore.getWithInheritance() to get the merged terminal set.
 */
export interface Frame {
  id:              string;          // ULID
  name:            string;          // e.g. "BlockPlacement", "TowerConstruction"
  description:     string;
  terminals:       Record<string, Terminal>;
  parent_frame_id: string | null;   // null = root frame
  frame_type:      FrameType;       // "standard" | "trans"
  roles:           TransFrameRoles | null;  // non-null only when frame_type === "trans"
  created_at:      number;          // Unix ms
  updated_at:      number;
}

// ─── Trans-frame ──────────────────────────────────────────────────────────────

/**
 * The six canonical roles of a trans-frame.
 *
 * Minsky §21: "Each such 'trans-frame' has terminals for an Actor, an Action,
 * an Object, an Origin, a Destination, and an Instrument."
 *
 * All roles except Action are nullable — a simple "grasp" event may not have
 * an explicit Origin or Instrument.
 */
export interface TransFrameRoles {
  Actor:       string | null;
  Action:      string;
  Object:      string | null;
  Origin:      string | null;
  Destination: string | null;
  Instrument:  string | null;
}

/**
 * A Frame that additionally carries the six canonical trans-frame roles.
 * Roles operate alongside terminals — terminals hold slot defaults for domain
 * reasoning; roles declare the structural transformation being represented.
 */
export interface TransFrame extends Frame {
  frame_type: "trans";
  roles:      TransFrameRoles;
}

/** Type-guard: narrows a Frame to a TransFrame. */
export function isTransFrame(frame: Frame): frame is TransFrame {
  return frame.frame_type === "trans" && frame.roles !== null;
}

// ─── Frame-array ──────────────────────────────────────────────────────────────

/**
 * A named collection of frames that share a terminal vocabulary.
 *
 * Minsky §24: "A frame-array is a collection of frames all of whose terminals
 * have the same names — but fill them with different assumptions."
 *
 * Switching perspective within a frame-array preserves any terminal value
 * that also exists in the target frame. Values unique to the old frame are
 * dropped; defaults from the new frame fill the rest.
 */
export interface FrameArrayRecord {
  id:         string;    // ULID
  name:       string;    // e.g. "BlockPerspectives"
  frame_ids:  string[];  // ordered list of member frame ULIDs
  created_at: number;
  updated_at: number;
}

export type FrameArrayInput = Omit<FrameArrayRecord, "id" | "created_at" | "updated_at">;

// ─── Input ────────────────────────────────────────────────────────────────────

/**
 * What callers provide to FrameStore.write(). id and timestamps are assigned.
 * frame_type and roles are optional and default to "standard" / null.
 */
export type FrameInput =
  Omit<Frame, "id" | "created_at" | "updated_at" | "frame_type" | "roles"> & {
    frame_type?: FrameType;
    roles?:      TransFrameRoles | null;
  };

// ─── List options ─────────────────────────────────────────────────────────────

export interface FrameListOptions {
  parentId?: string | null;   // Filter by parent (null = root frames only)
  limit?:    number;
  offset?:   number;
}
