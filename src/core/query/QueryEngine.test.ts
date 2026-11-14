import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventLog } from "../event-log/index.ts";
import { PolynemeBus } from "../polyneme-bus/PolynemeBus.ts";
import { Agent } from "../agent/Agent.ts";
import { QueryEngine } from "./QueryEngine.ts";

const flush = () => new Promise((r) => setTimeout(r, 10));

let tmpDir: string;
let log: EventLog;
let bus: PolynemeBus;
let engine: QueryEngine;

before(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "som-query-test-"));
  log    = EventLog.open(join(tmpDir, "test.db"));
  bus    = new PolynemeBus(log);
  engine = new QueryEngine(log, bus);
});

after(async () => {
  log.close();
  await rm(tmpDir, { recursive: true });
});

describe("QueryEngine", () => {

  // ─── ACTIVATION_QUERY ───────────────────────────────────────────────────────

  it("ACTIVATION_QUERY: returns active/dormant states derived from event log", async () => {
    const agentA = new Agent({
      id: "qa-agent-a", name: "QA-A", systemPrompt: "",
      signals: ["qa.*"], handler: () => ({ emit: [] }),
    });
    const agentB = new Agent({
      id: "qa-agent-b", name: "QA-B", systemPrompt: "",
      signals: ["qa.*"], handler: () => ({ emit: [] }),
    });

    const disconnectA = agentA.connect(bus);
    const disconnectB = agentB.connect(bus);
    await flush();

    const result = engine.activationQuery();
    assert.equal(result.type, "ACTIVATION_QUERY");

    const stateMap = Object.fromEntries(result.agents.map((a) => [a.id, a.state]));
    assert.equal(stateMap["qa-agent-a"], "active");
    assert.equal(stateMap["qa-agent-b"], "active");

    disconnectA();
    await flush();

    const result2 = engine.activationQuery();
    const stateMap2 = Object.fromEntries(result2.agents.map((a) => [a.id, a.state]));
    assert.equal(stateMap2["qa-agent-a"], "dormant");
    assert.equal(stateMap2["qa-agent-b"], "active");

    disconnectB();
  });

  // ─── CAUSAL_TRACE ───────────────────────────────────────────────────────────

  it("CAUSAL_TRACE: returns chain root-first for a chain of 3 events", async () => {
    const id1 = bus.emit({ source: "test", signal: "ct.root",   type: "polyneme", payload: {}, causedBy: null });
    const id2 = bus.emit({ source: "test", signal: "ct.middle", type: "polyneme", payload: {}, causedBy: id1 });
    const id3 = bus.emit({ source: "test", signal: "ct.leaf",   type: "polyneme", payload: {}, causedBy: id2 });

    const result = engine.causalTrace(id3);
    assert.equal(result.type, "CAUSAL_TRACE");
    assert.equal(result.eventId, id3);
    assert.equal(result.complete, true);
    assert.equal(result.chain.length, 3);
    assert.equal(result.chain[0].id, id1); // root first
    assert.equal(result.chain[1].id, id2);
    assert.equal(result.chain[2].id, id3);
    assert.equal(result.chain[0].signal, "ct.root");
    assert.equal(result.chain[2].signal, "ct.leaf");
  });

  it("CAUSAL_TRACE: single root event (no causedBy) returns chain of 1, complete=true", async () => {
    const id = bus.emit({ source: "test", signal: "ct.solo", type: "polyneme", payload: {}, causedBy: null });

    const result = engine.causalTrace(id);
    assert.equal(result.chain.length, 1);
    assert.equal(result.complete, true);
    assert.equal(result.chain[0].id, id);
  });

  it("CAUSAL_TRACE: unknown event id returns empty chain, complete=false", () => {
    const result = engine.causalTrace("01ZZZZZZZZZZZZZZZZZZZZZZZZZ");
    assert.equal(result.chain.length, 0);
    assert.equal(result.complete, false);
  });

  // ─── REASONING_PROBE ────────────────────────────────────────────────────────

  it("REASONING_PROBE: returns what a deterministic agent would emit", async () => {
    const agent = new Agent({
      id: "probe-agent", name: "ProbeAgent", systemPrompt: "",
      signals: ["probe.trigger"],
      handler: (ctx) => ({
        emit: [{
          signal:  "probe.response",
          type:    "polyneme" as const,
          payload: { echo: ctx.trigger.signal },
        }],
      }),
    });

    const fakeTrigger = {
      id: "fake-01", timestamp: Date.now(), source: "test",
      signal: "probe.trigger", type: "polyneme" as const,
      payload: {}, causedBy: null,
      context: { pronomes: {}, frame_id: null, kline_ids: [], micronemes: [] },
    };

    const result = await engine.query({ type: "REASONING_PROBE", trigger: fakeTrigger, agentId: "probe-agent" }, agent);
    assert.equal(result.type, "REASONING_PROBE");
    if (result.type !== "REASONING_PROBE") return;
    assert.equal(result.stub, false);
    assert.equal(result.wouldEmit.length, 1);
    assert.equal(result.wouldEmit[0].signal, "probe.response");
    assert.equal(result.wouldEmit[0].payload.echo, "probe.trigger");
  });

  it("REASONING_PROBE: LLM-backed agent returns stub=true with empty wouldEmit", async () => {
    const llmAgent = new Agent({
      id: "llm-probe-agent", name: "LLMProbe", systemPrompt: "You reason.",
      signals: ["probe.llm"],
      // No handler → LLM-backed
    });

    const fakeTrigger = {
      id: "fake-02", timestamp: Date.now(), source: "test",
      signal: "probe.llm", type: "polyneme" as const,
      payload: {}, causedBy: null,
      context: { pronomes: {}, frame_id: null, kline_ids: [], micronemes: [] },
    };

    const result = await engine.query({ type: "REASONING_PROBE", trigger: fakeTrigger, agentId: "llm-probe-agent" }, llmAgent);
    assert.equal(result.type, "REASONING_PROBE");
    if (result.type !== "REASONING_PROBE") return;
    assert.equal(result.stub, true);
    assert.deepEqual(result.wouldEmit, []);
  });

  it("REASONING_PROBE: pronomes from bus are available in handler context", async () => {
    bus.bindPronome("TestRole", "role-agent-01");
    await flush();

    let capturedPronomes: Record<string, string> = {};
    const agent = new Agent({
      id: "pronome-probe-agent", name: "PronomeProbe", systemPrompt: "",
      signals: ["probe.pronome"],
      handler: (ctx) => {
        capturedPronomes = ctx.pronomes;
        return { emit: [] };
      },
    });

    const fakeTrigger = {
      id: "fake-03", timestamp: Date.now(), source: "test",
      signal: "probe.pronome", type: "polyneme" as const,
      payload: {}, causedBy: null,
      context: { pronomes: {}, frame_id: null, kline_ids: [], micronemes: [] },
    };

    await engine.query({ type: "REASONING_PROBE", trigger: fakeTrigger, agentId: agent.id }, agent);
    assert.equal(capturedPronomes["TestRole"], "role-agent-01");

    bus.releasePronome("TestRole");
  });

  // ─── MEMORY_PROBE / CENSOR_CHECK stubs ─────────────────────────────────────

  it("MEMORY_PROBE: returns empty stub result", async () => {
    const result = await engine.query({ type: "MEMORY_PROBE", situation: "block stacking" });
    assert.equal(result.type, "MEMORY_PROBE");
    if (result.type !== "MEMORY_PROBE") return;
    assert.equal(result.stub, true);
    assert.deepEqual(result.klines, []);
    assert.equal(result.situation, "block stacking");
  });

  it("CENSOR_CHECK: returns stub with wouldFire=false", async () => {
    const result = await engine.query({
      type: "CENSOR_CHECK",
      agentId: "grasp-agent",
      action: "pick_up_block",
      situation: "block already in tower",
    });
    assert.equal(result.type, "CENSOR_CHECK");
    if (result.type !== "CENSOR_CHECK") return;
    assert.equal(result.stub, true);
    assert.equal(result.wouldFire, false);
  });

});
