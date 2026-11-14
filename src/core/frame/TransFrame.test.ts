import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FrameStore } from "./FrameStore.ts";
import { isTransFrame } from "./types.ts";
import type { TransFrameRoles } from "./types.ts";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

let tmpDir:    string;
let store:     FrameStore;

before(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "som-transframe-test-"));
  store  = FrameStore.open(join(tmpDir, "frames.db"));
});

after(async () => {
  store.close();
  await rm(tmpDir, { recursive: true });
});

// ─── Trans-frame tests ────────────────────────────────────────────────────────

describe("TransFrame", () => {

  it("writeTransFrame stores frame_type=trans and roles", () => {
    const roles: TransFrameRoles = {
      Actor:       "grasp-agent",
      Action:      "grasp",
      Object:      "block-A",
      Origin:      null,
      Destination: "grip-position",
      Instrument:  null,
    };

    const id = store.writeTransFrame({
      name:            "GraspAction",
      description:     "Agent extends manipulator arm to grasp an object",
      terminals: {
        Actor:  { name: "Actor",  type: "agent_id", default_value: "grasp-agent", default_confidence: 0.7, required: true },
        Object: { name: "Object", type: "string",   default_value: null,           default_confidence: 0,   required: true },
      },
      parent_frame_id: null,
      roles,
    });

    assert.ok(id);
    const fetched = store.getById(id);
    assert.ok(fetched);
    assert.equal(fetched.frame_type, "trans");
    assert.deepEqual(fetched.roles, roles);
  });

  it("isTransFrame type-guard returns true for trans frame, false for standard", () => {
    const transId = store.writeTransFrame({
      name: "PlaceAction",
      description: "Agent places object at target",
      terminals: {},
      parent_frame_id: null,
      roles: {
        Actor: "place-agent", Action: "place",
        Object: "block-B", Origin: null, Destination: "tower-top", Instrument: null,
      },
    });

    const standardId = store.write({
      name: "StandardFrame",
      description: "A plain frame with no roles",
      terminals: {},
      parent_frame_id: null,
    });

    const trans    = store.getById(transId)!;
    const standard = store.getById(standardId)!;

    assert.ok(isTransFrame(trans),     "trans frame should pass isTransFrame");
    assert.ok(!isTransFrame(standard), "standard frame should fail isTransFrame");
  });

  it("getTransFrame returns narrowed TransFrame type", () => {
    const roles: TransFrameRoles = {
      Actor: "move-agent", Action: "move",
      Object: "block-C", Origin: "shelf", Destination: "table", Instrument: null,
    };

    const id = store.writeTransFrame({
      name: "MoveAction",
      description: "Agent moves object from origin to destination",
      terminals: { Actor: { name: "Actor", type: "agent_id", default_value: null, default_confidence: 0, required: true } },
      parent_frame_id: null,
      roles,
    });

    const tf = store.getTransFrame(id);
    assert.ok(tf !== null);
    assert.equal(tf.frame_type, "trans");
    assert.equal(tf.roles.Action, "move");
    assert.equal(tf.roles.Origin, "shelf");
  });

  it("getTransFrame returns null for a standard frame id", () => {
    const id = store.write({
      name: "AnotherStandard",
      description: "not a trans-frame",
      terminals: {},
      parent_frame_id: null,
    });
    assert.equal(store.getTransFrame(id), null);
  });

  it("getTransFrame returns null for a nonexistent id", () => {
    assert.equal(store.getTransFrame("01NOTEXIST000000000000000"), null);
  });

  it("standard write() sets frame_type=standard and roles=null", () => {
    const id = store.write({
      name: "StandardCheck",
      description: "verify defaults",
      terminals: {},
      parent_frame_id: null,
    });
    const frame = store.getById(id)!;
    assert.equal(frame.frame_type, "standard");
    assert.equal(frame.roles, null);
  });

  it("trans-frame roles survive prototype inheritance chain", () => {
    const parentId = store.writeTransFrame({
      name: "BaseTransAction",
      description: "Base action frame",
      terminals: {
        Actor: { name: "Actor", type: "agent_id", default_value: "base-agent", default_confidence: 0.3, required: false },
      },
      parent_frame_id: null,
      roles: {
        Actor: "base-agent", Action: "base-action",
        Object: null, Origin: null, Destination: null, Instrument: null,
      },
    });

    const childId = store.writeTransFrame({
      name: "SpecializedAction",
      description: "Specialized child action",
      terminals: {
        Object: { name: "Object", type: "string", default_value: null, default_confidence: 0, required: true },
      },
      parent_frame_id: parentId,
      roles: {
        Actor: "specialized-agent", Action: "specialized-action",
        Object: "block-D", Origin: null, Destination: "goal", Instrument: null,
      },
    });

    const inherited = store.getWithInheritance(childId)!;
    // Child's terminals include inherited Actor from parent + own Object
    assert.ok("Actor" in inherited.terminals);
    assert.ok("Object" in inherited.terminals);
    // Roles come from the child row directly
    const tf = store.getTransFrame(childId)!;
    assert.equal(tf.roles.Actor, "specialized-agent");
    assert.equal(tf.roles.Destination, "goal");
  });
});

// ─── Frame-array tests ────────────────────────────────────────────────────────

describe("FrameArray", () => {

  let grasperId:     string;
  let placerId:      string;
  let observerId:    string;
  let arrayId:       string;

  before(() => {
    // Three perspectives on a block-manipulation situation
    grasperId = store.write({
      name: "GrasperPerspective",
      description: "Block manipulation from grasper's point of view",
      terminals: {
        Actor:  { name: "Actor",  type: "agent_id", default_value: "grasp-agent", default_confidence: 0.8, required: true },
        Object: { name: "Object", type: "string",   default_value: null,           default_confidence: 0,   required: true },
        Force:  { name: "Force",  type: "number",   default_value: 0.5,            default_confidence: 0.5, required: false },
      },
      parent_frame_id: null,
    });

    placerId = store.write({
      name: "PlacerPerspective",
      description: "Block manipulation from placer's point of view",
      terminals: {
        Actor:       { name: "Actor",       type: "agent_id", default_value: "place-agent", default_confidence: 0.8, required: true },
        Object:      { name: "Object",      type: "string",   default_value: null,            default_confidence: 0,   required: true },
        Destination: { name: "Destination", type: "string",   default_value: "tower-top",    default_confidence: 0.6, required: false },
      },
      parent_frame_id: null,
    });

    observerId = store.write({
      name: "ObserverPerspective",
      description: "External observer of the block manipulation",
      terminals: {
        Actor:  { name: "Actor",  type: "agent_id", default_value: null, default_confidence: 0, required: false },
        Object: { name: "Object", type: "string",   default_value: null, default_confidence: 0, required: false },
        Event:  { name: "Event",  type: "string",   default_value: null, default_confidence: 0, required: false },
      },
      parent_frame_id: null,
    });

    arrayId = store.writeFrameArray({
      name:      "BlockManipulationPerspectives",
      frame_ids: [grasperId, placerId, observerId],
    });
  });

  it("writeFrameArray returns a ULID id", () => {
    assert.ok(arrayId.length > 0);
  });

  it("getFrameArray retrieves array with all member frame ids", () => {
    const arr = store.getFrameArray(arrayId);
    assert.ok(arr !== null);
    assert.equal(arr.name, "BlockManipulationPerspectives");
    assert.equal(arr.frame_ids.length, 3);
    assert.ok(arr.frame_ids.includes(grasperId));
    assert.ok(arr.frame_ids.includes(placerId));
    assert.ok(arr.frame_ids.includes(observerId));
  });

  it("getFrameArrayByName retrieves by name", () => {
    const arr = store.getFrameArrayByName("BlockManipulationPerspectives");
    assert.ok(arr !== null);
    assert.equal(arr.id, arrayId);
  });

  it("getFrameArray returns null for nonexistent id", () => {
    assert.equal(store.getFrameArray("01NOTEXIST000000000000000"), null);
  });

  it("switchPerspective returns target frame", () => {
    const result = store.switchPerspective(arrayId, placerId, {});
    assert.ok(result !== null);
    assert.equal(result.frame.id, placerId);
    assert.ok("Actor" in result.frame.terminals);
    assert.ok("Destination" in result.frame.terminals);
  });

  it("switchPerspective preserves shared terminal values", () => {
    // Actor and Object exist in both GrasperPerspective and PlacerPerspective
    const currentValues = {
      Actor:  "special-grasp-agent",
      Object: "block-X",
      Force:  0.9,           // only in grasper — should be dropped
    };

    const result = store.switchPerspective(arrayId, placerId, currentValues);
    assert.ok(result !== null);

    // Actor and Object shared → preserved
    assert.equal(result.preserved["Actor"],  "special-grasp-agent");
    assert.equal(result.preserved["Object"], "block-X");

    // Force not in placer's terminals → dropped
    assert.equal(result.preserved["Force"], undefined);
  });

  it("switchPerspective drops non-shared terminal values", () => {
    const currentValues = {
      Actor:       "grasp-agent",
      Object:      "block-Y",
      Destination: "shelf",    // only in placer — should be dropped when switching to observer
    };

    // Switch from placer to observer perspective
    const result = store.switchPerspective(arrayId, observerId, currentValues);
    assert.ok(result !== null);

    // Actor and Object are in observer → preserved
    assert.equal(result.preserved["Actor"],  "grasp-agent");
    assert.equal(result.preserved["Object"], "block-Y");

    // Destination not in observer's terminals → dropped
    assert.equal(result.preserved["Destination"], undefined);
  });

  it("switchPerspective returns null when toFrameId not in array", () => {
    const outsiderId = store.write({
      name: "OutsiderFrame",
      description: "not a member of the array",
      terminals: {},
      parent_frame_id: null,
    });

    const result = store.switchPerspective(arrayId, outsiderId, {});
    assert.equal(result, null);
  });

  it("switchPerspective returns null for nonexistent arrayId", () => {
    const result = store.switchPerspective("01NOTEXIST000000000000000", grasperId, {});
    assert.equal(result, null);
  });

  it("perspective switch is case-insensitive on terminal name matching", () => {
    // Pass lowercase 'actor' — should still match 'Actor' terminal
    const result = store.switchPerspective(arrayId, placerId, {
      actor:  "case-agent",
      object: "case-block",
    });
    assert.ok(result !== null);
    assert.equal(result.preserved["actor"],  "case-agent");
    assert.equal(result.preserved["object"], "case-block");
  });
});
