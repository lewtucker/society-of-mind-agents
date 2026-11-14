import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KLineStore } from "./KLineStore.ts";
import { emptyBands } from "./types.ts";
import type { KLineInput } from "./types.ts";

let tmpDir: string;
let store: KLineStore;

before(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "som-kline-test-"));
  store  = KLineStore.open(join(tmpDir, "klines.db"));
});

after(async () => {
  store.close();
  await rm(tmpDir, { recursive: true });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePositive(overrides: Partial<KLineInput> = {}): KLineInput {
  return {
    type: "positive",
    situation: {
      description: "Successfully placed block A onto the tower base",
      frame_id:    "block-placement-frame",
      pronomes:    { Actor: "grasp-agent", Goal: "tower-top" },
      micronemes:  [0.1, 0.5, 0.9],
      realm:       ["physical"],
    },
    activations: [
      { agent_id: "find-agent",  agent_type: "FindAgent",  role: null, band: "core",       confidence: 1.0, signal_ids: ["ev-01"] },
      { agent_id: "grasp-agent", agent_type: "GraspAgent", role: "Actor", band: "core",    confidence: 1.0, signal_ids: ["ev-02"] },
      { agent_id: "move-agent",  agent_type: "MoveAgent",  role: null, band: "peripheral", confidence: 0.7, signal_ids: ["ev-03"] },
      { agent_id: "see-agent",   agent_type: "SeeAgent",   role: null, band: "fringe",     confidence: 0.2, signal_ids: [] },
    ],
    bands: {
      core:       { agents: ["find-agent", "grasp-agent"], properties: {}, decay_rate: 0   },
      peripheral: { agents: ["move-agent"],                 properties: { position: { value: [2, 0], confidence: 0.8 } }, decay_rate: 180 },
      fringe:     { agents: ["see-agent"],                  properties: {}, decay_rate: 30  },
    },
    guard:         null,
    parent_id:     null,
    source_events: ["ev-01", "ev-02", "ev-03"],
    task_id:       "task-build-001",
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("KLineStore", () => {

  it("write() returns a ULID and stores the K-line", () => {
    const id = store.write(makePositive());
    assert.ok(id.length > 0, "id should be non-empty ULID");
    assert.equal(store.count(), 1);
  });

  it("getById() retrieves the written K-line", () => {
    const id = store.write(makePositive());
    const kl = store.getById(id);
    assert.ok(kl !== null);
    assert.equal(kl.id, id);
    assert.equal(kl.type, "positive");
    assert.equal(kl.situation.description, "Successfully placed block A onto the tower base");
    assert.equal(kl.situation.frame_id, "block-placement-frame");
    assert.equal(kl.task_id, "task-build-001");
    assert.equal(kl.retrieval_count, 0);
    assert.equal(kl.last_retrieved, null);
  });

  it("level-band weights survive serialization round-trip", () => {
    const id = store.write(makePositive());
    const kl = store.getById(id)!;

    assert.deepEqual(kl.bands.core.agents,       ["find-agent", "grasp-agent"]);
    assert.deepEqual(kl.bands.peripheral.agents, ["move-agent"]);
    assert.deepEqual(kl.bands.fringe.agents,     ["see-agent"]);
    assert.equal(kl.bands.core.decay_rate,       0);
    assert.equal(kl.bands.peripheral.decay_rate, 180);
    assert.equal(kl.bands.fringe.decay_rate,     30);
    assert.equal(kl.bands.peripheral.properties["position"].confidence, 0.8);
  });

  it("pronomes, realm, micronemes round-trip through JSON", () => {
    const id = store.write(makePositive());
    const kl = store.getById(id)!;
    assert.equal(kl.situation.pronomes["Actor"],  "grasp-agent");
    assert.equal(kl.situation.pronomes["Goal"],   "tower-top");
    assert.deepEqual(kl.situation.realm,          ["physical"]);
    assert.deepEqual(kl.situation.micronemes,     [0.1, 0.5, 0.9]);
  });

  it("activations round-trip with all fields", () => {
    const id = store.write(makePositive());
    const kl = store.getById(id)!;
    assert.equal(kl.activations.length, 4);
    const grasp = kl.activations.find((a) => a.agent_id === "grasp-agent")!;
    assert.equal(grasp.band, "core");
    assert.equal(grasp.confidence, 1.0);
    assert.equal(grasp.role, "Actor");
    assert.deepEqual(grasp.signal_ids, ["ev-02"]);
  });

  it("getById() returns null for unknown id", () => {
    assert.equal(store.getById("01ZZZZZZZZZZZZZZZZZZZZZZZZZ"), null);
  });

  it("censor K-line: guard field survives round-trip", () => {
    const id = store.write({
      type: "censor",
      situation: {
        description: "About to pick up block already in the tower",
        frame_id:    "block-placement-frame",
        pronomes:    { Actor: "grasp-agent" },
        micronemes:  [],
        realm:       ["physical"],
      },
      activations: [],
      bands:        emptyBands(),
      guard: {
        precursor_pattern:   "Agent attempts to grasp a block already in the tower",
        blocked_action:      "grasp_block",
        outcome_description: "Tower collapses — block was load-bearing",
      },
      parent_id:     null,
      source_events: [],
      task_id:       null,
    });

    const kl = store.getById(id)!;
    assert.equal(kl.type, "censor");
    assert.ok(kl.guard !== null);
    assert.ok(kl.guard.precursor_pattern.includes("already in the tower"));
    assert.equal(kl.guard.blocked_action, "grasp_block");
  });

  it("parent_id → child_ids updated automatically on write", () => {
    const parentId = store.write(makePositive({ task_id: "parent-task" }));

    const child1Id = store.write(makePositive({ parent_id: parentId, task_id: "child-task-1" }));
    const child2Id = store.write(makePositive({ parent_id: parentId, task_id: "child-task-2" }));

    const parent = store.getById(parentId)!;
    assert.ok(parent.child_ids.includes(child1Id));
    assert.ok(parent.child_ids.includes(child2Id));

    const child1 = store.getById(child1Id)!;
    assert.equal(child1.parent_id, parentId);
  });

  it("list() returns K-lines, most recent first by default", () => {
    const before = store.count();
    store.write(makePositive({ task_id: "list-task-a" }));
    store.write(makePositive({ task_id: "list-task-b" }));
    store.write(makePositive({ task_id: "list-task-c" }));

    const all = store.list({ limit: 3, offset: 0 });
    assert.equal(all.length, 3);
    // Most recent first: created_at DESC
    assert.ok(all[0].created_at >= all[1].created_at);
    assert.ok(all[1].created_at >= all[2].created_at);
    assert.equal(store.count(), before + 3);
  });

  it("list() filters by type", () => {
    const censorId = store.write({
      type: "censor",
      situation: { description: "censor test", frame_id: null, pronomes: {}, micronemes: [], realm: [] },
      activations: [], bands: emptyBands(), guard: {
        precursor_pattern: "test pattern", blocked_action: "test_action", outcome_description: "bad"
      },
      parent_id: null, source_events: [], task_id: "type-filter-test",
    });

    const censors = store.list({ type: "censor", taskId: "type-filter-test" });
    assert.ok(censors.some((k) => k.id === censorId));
    assert.ok(censors.every((k) => k.type === "censor"));

    const positives = store.list({ type: "positive", taskId: "type-filter-test" });
    assert.ok(positives.every((k) => k.type === "positive"));
  });

  it("list() filters by frameId", () => {
    store.write(makePositive({ situation: { ...makePositive().situation, frame_id: "unique-frame-xyz" } }));
    const results = store.list({ frameId: "unique-frame-xyz" });
    assert.ok(results.length >= 1);
    assert.ok(results.every((k) => k.situation.frame_id === "unique-frame-xyz"));
  });

  it("incrementRetrievalCount() increments count and sets last_retrieved", () => {
    const id = store.write(makePositive());
    const before = store.getById(id)!;
    assert.equal(before.retrieval_count, 0);
    assert.equal(before.last_retrieved,  null);

    store.incrementRetrievalCount(id);
    store.incrementRetrievalCount(id);

    const after = store.getById(id)!;
    assert.equal(after.retrieval_count, 2);
    assert.ok(after.last_retrieved !== null && after.last_retrieved > 0);
  });

  it("searchFts() returns K-lines matching description keywords", () => {
    store.write(makePositive({
      situation: { ...makePositive().situation, description: "tower construction using wooden blocks" },
      task_id: "fts-test",
    }));

    const ids = store.searchFts("wooden blocks");
    assert.ok(ids.length >= 1, "FTS should return at least the written K-line");
  });

  it("embedding fields default to empty when not provided", () => {
    const id = store.write(makePositive());
    const kl = store.getById(id)!;
    assert.deepEqual(kl.embedding,       []);
    assert.equal(kl.embedding_model, "none");
    assert.equal(kl.embedding_hash,  "");
  });

  it("embedding round-trips when provided", () => {
    const vec = [0.1, 0.2, 0.3, 0.4, 0.5];
    const id = store.write(makePositive({
      embedding:       vec,
      embedding_model: "text-embedding-3-small",
      embedding_hash:  "abc123",
    }));
    const kl = store.getById(id)!;
    assert.deepEqual(kl.embedding,       vec);
    assert.equal(kl.embedding_model, "text-embedding-3-small");
    assert.equal(kl.embedding_hash,  "abc123");
  });

  it("persists across close/reopen", () => {
    const id = store.write(makePositive({ task_id: "persist-test" }));
    const dbPath = (store as unknown as { db: { name: string } }).db.name;
    store.close();

    const reopened = KLineStore.open(dbPath);
    const kl = reopened.getById(id);
    assert.ok(kl !== null);
    assert.equal(kl.task_id, "persist-test");
    reopened.close();

    // Re-open for remaining tests
    store = KLineStore.open(dbPath);
  });

  it("read-only store throws on write()", () => {
    const dbPath = (store as unknown as { db: { name: string } }).db.name;
    const ro = KLineStore.openReadOnly(dbPath);
    assert.throws(
      () => ro.write(makePositive()),
      /read-only/,
    );
    ro.close();
  });

  it("ULIDs maintain temporal order for rapid sequential writes", () => {
    const ids = Array.from({ length: 5 }, () => store.write(makePositive()));
    for (let i = 1; i < ids.length; i++) {
      assert.ok(ids[i] > ids[i - 1], `ULID ${ids[i]} should be > ${ids[i - 1]}`);
    }
  });
});
