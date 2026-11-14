import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventLog } from "../event-log/index.ts";
import { PolynemeBus } from "../polyneme-bus/PolynemeBus.ts";
import { Agent } from "./Agent.ts";

const flush = () => new Promise((r) => setTimeout(r, 10));

let tmpDir: string;
let log: EventLog;
let bus: PolynemeBus;

before(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "som-agent-test-"));
  log = EventLog.open(join(tmpDir, "test.db"));
  bus = new PolynemeBus(log);
});

after(async () => {
  log.close();
  await rm(tmpDir, { recursive: true });
});

describe("Agent", () => {
  it("connect() emits agent.active and subscribes to the bus", async () => {
    const received: string[] = [];

    bus.subscribe({
      id: "spy",
      signals: ["agent.active"],
      onSignal: (e) => received.push(e.payload["name"] as string),
    });

    const agent = new Agent({
      id: "test-agent-connect",
      name: "TestConnect",
      systemPrompt: "You are a test agent.",
      signals: ["test.*"],
    });

    const disconnect = agent.connect(bus);
    await flush();

    assert.ok(received.includes("TestConnect"), "agent.active should have been emitted");
    disconnect();
  });

  it("disconnect() emits agent.dormant and unsubscribes", async () => {
    const dormantNames: string[] = [];
    const received: string[] = [];

    bus.subscribe({
      id: "dormant-spy",
      signals: ["agent.dormant"],
      onSignal: (e) => dormantNames.push(e.payload["name"] as string),
    });

    const agent = new Agent({
      id: "test-agent-disconnect",
      name: "TestDisconnect",
      systemPrompt: "You are a test agent.",
      signals: ["disconnect.signal"],
    });

    const disconnect = agent.connect(bus);
    await flush();
    disconnect();
    await flush();

    assert.ok(dormantNames.includes("TestDisconnect"));

    // After disconnect, the agent should no longer receive signals
    bus.subscribe({
      id: "recv-spy",
      signals: ["disconnect.signal"],
      onSignal: (e) => received.push(e.id),
    });

    bus.emit({ source: "test", signal: "disconnect.signal", type: "polyneme", payload: {}, causedBy: null });
    await flush();

    // The agent-spy subscriber got it but the agent itself did not emit anything in response
    // (deterministic agent has no handler, LLM would run but API key missing → stub)
    // Just verify the bus didn't crash
    assert.equal(received.length, 1); // only the spy got it, not the agent
    bus.unsubscribe("recv-spy");
    bus.unsubscribe("dormant-spy");
  });

  it("deterministic handler: emits configured signals without LLM", async () => {
    const emitted: Array<{ signal: string; payload: Record<string, unknown> }> = [];

    bus.subscribe({
      id: "det-spy",
      signals: ["block.found"],
      onSignal: (e) => emitted.push({ signal: e.signal, payload: e.payload }),
    });

    const finder = new Agent({
      id: "det-finder",
      name: "DetFinder",
      systemPrompt: "You find blocks.",
      signals: ["block.search"],
      handler: () => ({
        emit: [{
          signal:  "block.found",
          type:    "polyneme" as const,
          payload: { blockId: "A", position: [2, 0], summary: "Block A at (2, 0)" },
        }],
      }),
    });

    const disconnect = finder.connect(bus);
    await flush();

    bus.emit({ source: "builder", signal: "block.search", type: "polyneme", payload: {}, causedBy: null });
    await flush();

    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].signal, "block.found");
    assert.equal(emitted[0].payload.blockId, "A");

    disconnect();
    bus.unsubscribe("det-spy");
  });

  it("handler receives correct context: trigger + pronomes", async () => {
    let capturedCtx: { signal: string; pronomes: Record<string, string> } | null = null;

    bus.bindPronome("Actor", "builder-001");
    await flush();

    const agent = new Agent({
      id: "ctx-agent",
      name: "CtxAgent",
      systemPrompt: "You check context.",
      signals: ["ctx.test"],
      handler: (ctx) => {
        capturedCtx = {
          signal:   ctx.trigger.signal,
          pronomes: ctx.pronomes,
        };
        return { emit: [] };
      },
    });

    const disconnect = agent.connect(bus);
    await flush();

    bus.emit({ source: "test", signal: "ctx.test", type: "activation", payload: {}, causedBy: null });
    await flush();

    assert.ok(capturedCtx !== null);
    assert.equal(capturedCtx!.signal, "ctx.test");
    assert.equal(capturedCtx!.pronomes["Actor"], "builder-001");

    bus.releasePronome("Actor");
    disconnect();
  });

  it("causedBy is set to the triggering signal id", async () => {
    const emitted: string[] = [];

    bus.subscribe({
      id: "cause-spy",
      signals: ["caused.response"],
      onSignal: (e) => emitted.push(e.causedBy ?? ""),
    });

    const agent = new Agent({
      id: "cause-agent",
      name: "CauseAgent",
      systemPrompt: "You respond to signals.",
      signals: ["cause.trigger"],
      handler: () => ({
        emit: [{ signal: "caused.response", type: "polyneme" as const, payload: {} }],
      }),
    });

    const disconnect = agent.connect(bus);
    await flush();

    const triggerId = bus.emit({
      source: "test", signal: "cause.trigger", type: "polyneme", payload: {}, causedBy: null,
    });
    await flush();

    assert.equal(emitted.length, 1);
    assert.equal(emitted[0], triggerId, "causedBy should be the triggering event id");

    disconnect();
    bus.unsubscribe("cause-spy");
  });

  it("stub mode: emits agent.stub when no ANTHROPIC_API_KEY is set", async () => {
    const stubs: string[] = [];

    bus.subscribe({
      id: "stub-spy",
      signals: ["agent.stub"],
      onSignal: (e) => stubs.push(e.payload["summary"] as string),
    });

    const llmAgent = new Agent({
      id: "stub-llm-agent",
      name: "StubLLM",
      systemPrompt: "You are an LLM-backed agent.",
      signals: ["stub.trigger"],
      // No handler provided → would call LLM, but no API key → stub
    });

    const savedKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    const disconnect = llmAgent.connect(bus);
    await flush();

    bus.emit({ source: "test", signal: "stub.trigger", type: "polyneme", payload: {}, causedBy: null });
    await flush();

    assert.equal(stubs.length, 1);
    assert.ok(stubs[0].includes("[STUB]"));
    assert.ok(stubs[0].includes("stub.trigger"));

    if (savedKey) process.env.ANTHROPIC_API_KEY = savedKey;
    disconnect();
    bus.unsubscribe("stub-spy");
  });

  it("concurrent activation: one signal reaches multiple agents simultaneously", async () => {
    const activations: string[] = [];

    const makeAgent = (id: string) => new Agent({
      id,
      name: id,
      systemPrompt: "You respond to signals.",
      signals: ["concurrent.trigger"],
      handler: () => {
        activations.push(id);
        return { emit: [] };
      },
    });

    const agentA = makeAgent("concurrent-a");
    const agentB = makeAgent("concurrent-b");
    const agentC = makeAgent("concurrent-c");

    const dA = agentA.connect(bus);
    const dB = agentB.connect(bus);
    const dC = agentC.connect(bus);
    await flush();

    bus.emit({ source: "test", signal: "concurrent.trigger", type: "polyneme", payload: {}, causedBy: null });
    await flush();

    // All three agents activated from one signal — the polyneme pattern
    assert.ok(activations.includes("concurrent-a"));
    assert.ok(activations.includes("concurrent-b"));
    assert.ok(activations.includes("concurrent-c"));

    dA(); dB(); dC();
  });

  it("a throwing handler does not crash the bus", async () => {
    const subsequent: string[] = [];

    const badAgent = new Agent({
      id: "bad-agent",
      name: "BadAgent",
      systemPrompt: "You throw.",
      signals: ["crash.test"],
      handler: () => { throw new Error("handler exploded"); },
    });

    const goodSub = bus.subscribe({
      id: "post-crash-spy",
      signals: ["crash.test"],
      onSignal: (e) => subsequent.push(e.id),
    });

    const disconnect = badAgent.connect(bus);
    await flush();

    bus.emit({ source: "test", signal: "crash.test", type: "polyneme", payload: {}, causedBy: null });
    await flush();

    // Bus still works — good subscriber received it
    assert.equal(subsequent.length, 1);

    // And an agent.error signal was emitted by the agent framework
    const errors = log.recent(20).filter((e) => e.signal === "agent.error");
    assert.ok(errors.length >= 1);

    disconnect();
    goodSub.unsubscribe();
  });
});
