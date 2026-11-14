import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FrameStore } from "./FrameStore.ts";
import type { FrameInput, Terminal } from "./types.ts";

let tmpDir: string;
let store:  FrameStore;

before(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "som-frame-test-"));
  store  = FrameStore.open(join(tmpDir, "frames.db"));
});

after(async () => {
  store.close();
  await rm(tmpDir, { recursive: true });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeBlockPlacement(overrides: Partial<FrameInput> = {}): FrameInput {
  return {
    name:        "BlockPlacement",
    description: "Placing a block onto a target position",
    terminals: {
      Actor: {
        name:               "Actor",
        type:               "agent_id",
        default_value:      "grasp-agent",
        default_confidence: 0.6,
        required:           true,
      },
      Goal: {
        name:               "Goal",
        type:               "string",
        default_value:      "tower-top",
        default_confidence: 0.4,
        required:           false,
      },
      Object: {
        name:               "Object",
        type:               "string",
        default_value:      null,
        default_confidence: 0,
        required:           true,
      },
    },
    parent_frame_id: null,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("FrameStore", () => {

  it("write() returns a ULID and stores the frame", () => {
    const id = store.write(makeBlockPlacement());
    assert.ok(id.length > 0);
    assert.ok(store.count() >= 1);
  });

  it("getById() retrieves the written frame", () => {
    const id = store.write(makeBlockPlacement({ name: "GetById-Test" }));
    const f  = store.getById(id);
    assert.ok(f !== null);
    assert.equal(f.id, id);
    assert.equal(f.name, "GetById-Test");
    assert.equal(f.description, "Placing a block onto a target position");
    assert.equal(f.parent_frame_id, null);
  });

  it("getByName() retrieves by unique name", () => {
    store.write(makeBlockPlacement({ name: "GetByName-Test" }));
    const f = store.getByName("GetByName-Test");
    assert.ok(f !== null);
    assert.equal(f.name, "GetByName-Test");
  });

  it("getByName() returns null for unknown name", () => {
    assert.equal(store.getByName("NonExistentFrame-XYZ"), null);
  });

  it("terminals round-trip through JSON with all fields", () => {
    const id = store.write(makeBlockPlacement({ name: "Terminals-Test" }));
    const f  = store.getById(id)!;

    const actor = f.terminals["Actor"];
    assert.ok(actor !== undefined);
    assert.equal(actor.type,               "agent_id");
    assert.equal(actor.default_value,      "grasp-agent");
    assert.equal(actor.default_confidence, 0.6);
    assert.equal(actor.required,           true);

    const goal = f.terminals["Goal"];
    assert.equal(goal.default_value,      "tower-top");
    assert.equal(goal.default_confidence, 0.4);
    assert.equal(goal.required,           false);
  });

  it("terminals default to empty dict when not provided", () => {
    const id = store.write({ name: "Empty-Terminals", description: "no terminals", terminals: {}, parent_frame_id: null });
    const f  = store.getById(id)!;
    assert.deepEqual(f.terminals, {});
  });

  it("getById() returns null for unknown id", () => {
    assert.equal(store.getById("01ZZZZZZZZZZZZZZZZZZZZZZZZZ"), null);
  });

  it("upsertByName() returns existing id on second call", () => {
    const id1 = store.upsertByName(makeBlockPlacement({ name: "Upsert-Test" }));
    const id2 = store.upsertByName(makeBlockPlacement({ name: "Upsert-Test" }));
    assert.equal(id1, id2);
  });

  it("list() returns frames most-recent first", () => {
    store.write(makeBlockPlacement({ name: "List-A" }));
    store.write(makeBlockPlacement({ name: "List-B" }));
    store.write(makeBlockPlacement({ name: "List-C" }));
    const frames = store.list({ limit: 3 });
    assert.equal(frames.length, 3);
    assert.ok(frames[0].created_at >= frames[1].created_at);
  });

  it("list() filters root frames (parentId: null)", () => {
    const parentId = store.write(makeBlockPlacement({ name: "Root-For-Filter" }));
    store.write(makeBlockPlacement({ name: "Child-For-Filter", parent_frame_id: parentId }));

    const roots = store.list({ parentId: null });
    assert.ok(roots.every((f) => f.parent_frame_id === null));
    assert.ok(roots.some((f) => f.name === "Root-For-Filter"));
    assert.ok(!roots.some((f) => f.name === "Child-For-Filter"));
  });

  it("list() filters by parentId", () => {
    const parentId = store.write(makeBlockPlacement({ name: "Parent-For-Children" }));
    store.write(makeBlockPlacement({ name: "Child-A", parent_frame_id: parentId }));
    store.write(makeBlockPlacement({ name: "Child-B", parent_frame_id: parentId }));

    const children = store.list({ parentId });
    assert.ok(children.every((f) => f.parent_frame_id === parentId));
    assert.ok(children.some((f) => f.name === "Child-A"));
    assert.ok(children.some((f) => f.name === "Child-B"));
  });

  it("update() changes description and terminals", () => {
    const id = store.write(makeBlockPlacement({ name: "Update-Test" }));

    const newTerminal: Terminal = {
      name: "Instrument", type: "any",
      default_value: null, default_confidence: 0, required: false,
    };
    store.update(id, {
      description: "Updated description",
      terminals:   { Instrument: newTerminal },
    });

    const f = store.getById(id)!;
    assert.equal(f.description, "Updated description");
    assert.ok("Instrument" in f.terminals);
    assert.equal(f.terminals["Instrument"].type, "any");
  });

  it("update() throws for unknown id", () => {
    assert.throws(
      () => store.update("01ZZZZZZZZZZZZZZZZZZZZZZZZZ", { description: "nope" }),
      /not found/,
    );
  });

  // ─── Inheritance tests ───────────────────────────────────────────────────────

  it("getWithInheritance() returns own terminals for root frame", () => {
    const id = store.write(makeBlockPlacement({ name: "Root-Inherit" }));
    const f  = store.getWithInheritance(id)!;
    assert.ok(f !== null);
    assert.ok("Actor" in f.terminals);
    assert.ok("Goal" in f.terminals);
  });

  it("child frame inherits parent terminals", () => {
    const parentId = store.write({
      name:        "PhysicalAction",
      description: "Any physical manipulation",
      terminals: {
        Realm: {
          name: "Realm", type: "string",
          default_value: "physical", default_confidence: 0.9, required: false,
        },
        Actor: {
          name: "Actor", type: "agent_id",
          default_value: null, default_confidence: 0, required: true,
        },
      },
      parent_frame_id: null,
    });

    const childId = store.write({
      name:        "Grasp",
      description: "Grasp a block",
      terminals: {
        Object: {
          name: "Object", type: "string",
          default_value: null, default_confidence: 0, required: true,
        },
      },
      parent_frame_id: parentId,
    });

    const merged = store.getWithInheritance(childId)!;

    // Child's own terminal
    assert.ok("Object" in merged.terminals);
    // Inherited from parent
    assert.ok("Realm" in merged.terminals,  "should inherit Realm from parent");
    assert.ok("Actor" in merged.terminals,  "should inherit Actor from parent");
    assert.equal(merged.terminals["Realm"].default_value, "physical");
  });

  it("child terminal overrides parent terminal with same name", () => {
    const parentId = store.write({
      name:        "BaseAction",
      description: "Base",
      terminals: {
        Actor: {
          name: "Actor", type: "agent_id",
          default_value: "default-agent", default_confidence: 0.2, required: false,
        },
      },
      parent_frame_id: null,
    });

    const childId = store.write({
      name:        "SpecialisedAction",
      description: "Specialised",
      terminals: {
        Actor: {
          name: "Actor", type: "agent_id",
          // Child overrides with higher confidence and specific agent
          default_value:      "grasp-agent",
          default_confidence: 0.9,
          required:           true,
        },
      },
      parent_frame_id: parentId,
    });

    const merged = store.getWithInheritance(childId)!;
    assert.equal(merged.terminals["Actor"].default_value,      "grasp-agent");
    assert.equal(merged.terminals["Actor"].default_confidence, 0.9);
    assert.equal(merged.terminals["Actor"].required,           true);
  });

  it("three-level inheritance chain merges correctly", () => {
    const grandparentId = store.write({
      name:        "GrandparentFrame",
      description: "top",
      terminals: {
        T1: { name: "T1", type: "string", default_value: "from-grandparent", default_confidence: 0.1, required: false },
        T2: { name: "T2", type: "string", default_value: "from-grandparent", default_confidence: 0.1, required: false },
      },
      parent_frame_id: null,
    });

    const parentId2 = store.write({
      name:        "ParentFrame2",
      description: "mid",
      terminals: {
        // Overrides T2 from grandparent
        T2: { name: "T2", type: "string", default_value: "from-parent", default_confidence: 0.5, required: false },
        T3: { name: "T3", type: "string", default_value: "from-parent", default_confidence: 0.5, required: false },
      },
      parent_frame_id: grandparentId,
    });

    const childId2 = store.write({
      name:        "ChildFrame2",
      description: "leaf",
      terminals: {
        T4: { name: "T4", type: "string", default_value: "from-child", default_confidence: 0.9, required: true },
      },
      parent_frame_id: parentId2,
    });

    const merged = store.getWithInheritance(childId2)!;
    // T1 comes from grandparent unchanged
    assert.equal(merged.terminals["T1"].default_value, "from-grandparent");
    // T2 is overridden by parent (not grandparent)
    assert.equal(merged.terminals["T2"].default_value, "from-parent");
    // T3 comes from parent
    assert.equal(merged.terminals["T3"].default_value, "from-parent");
    // T4 is the child's own
    assert.equal(merged.terminals["T4"].default_value, "from-child");
    assert.equal(merged.terminals["T4"].required,      true);
  });

  it("getWithInheritance() returns null for unknown id", () => {
    assert.equal(store.getWithInheritance("01ZZZZZZZZZZZZZZZZZZZZZZZZZ"), null);
  });

  it("searchFts() finds frames by name keyword", () => {
    store.write({ name: "TowerConstruction", description: "Building a block tower", terminals: {}, parent_frame_id: null });
    const results = store.searchFts("tower");
    assert.ok(results.some((f) => f.name === "TowerConstruction"));
  });

  it("searchFts() finds frames by description keyword", () => {
    store.write({ name: "GraspFrame", description: "Agent extends manipulator to grasp target object", terminals: {}, parent_frame_id: null });
    const results = store.searchFts("manipulator grasp");
    assert.ok(results.some((f) => f.name === "GraspFrame"));
  });

  it("persists across close/reopen", () => {
    const id = store.write(makeBlockPlacement({ name: "Persist-Test" }));
    const dbPath = (store as unknown as { db: { name: string } }).db.name;
    store.close();

    const reopened = FrameStore.open(dbPath);
    const f = reopened.getById(id);
    assert.ok(f !== null);
    assert.equal(f.name, "Persist-Test");
    reopened.close();

    store = FrameStore.open(dbPath);
  });

  it("ULIDs maintain temporal order for sequential writes", () => {
    const ids = Array.from({ length: 5 }, (_, i) =>
      store.write({ name: `ULID-Order-${i}`, description: "", terminals: {}, parent_frame_id: null }),
    );
    for (let i = 1; i < ids.length; i++) {
      assert.ok(ids[i] > ids[i - 1], `ULID ${ids[i]} should be > ${ids[i - 1]}`);
    }
  });
});
