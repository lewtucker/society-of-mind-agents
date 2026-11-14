import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventLog } from "../event-log/index.ts";
import { PolynemeBus } from "../polyneme-bus/PolynemeBus.ts";
import { Agent } from "../agent/Agent.ts";
import { Agency } from "./Agency.ts";
import type { Connectable } from "./types.ts";

const flush = () => new Promise((r) => setTimeout(r, 10));

let tmpDir: string;
let log: EventLog;
let bus: PolynemeBus;

before(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "som-agency-test-"));
  log = EventLog.open(join(tmpDir, "test.db"));
  bus = new PolynemeBus(log);
});

after(async () => {
  log.close();
  await rm(tmpDir, { recursive: true });
});

function makeAgent(id: string, signals: string[] = ["test.*"]) {
  return new Agent({
    id,
    name: id,
    systemPrompt: "You are a test agent.",
    signals,
    handler: () => ({ emit: [] }),
  });
}

describe("Agency", () => {
  it("connect() emits agency.active with memberCount and memberIds", async () => {
    const activations: Array<{ memberCount: number; memberIds: string[] }> = [];

    bus.subscribe({
      id: "agency-active-spy",
      signals: ["agency.active"],
      onSignal: (e) => activations.push({
        memberCount: e.payload["memberCount"] as number,
        memberIds:   e.payload["memberIds"] as string[],
      }),
    });

    const agency = new Agency({
      id: "test-agency-connect",
      name: "TestAgency",
      members: [makeAgent("ta-member-a"), makeAgent("ta-member-b")],
    });

    const disconnect = agency.connect(bus);
    await flush();

    assert.equal(activations.length, 1);
    assert.equal(activations[0].memberCount, 2);
    assert.ok(activations[0].memberIds.includes("ta-member-a"));
    assert.ok(activations[0].memberIds.includes("ta-member-b"));

    disconnect();
    bus.unsubscribe("agency-active-spy");
  });

  it("connect() also emits agent.active for each member", async () => {
    const agentActives: string[] = [];

    bus.subscribe({
      id: "agent-active-spy",
      signals: ["agent.active"],
      onSignal: (e) => agentActives.push(e.source),
    });

    const agency = new Agency({
      id: "test-agency-members",
      name: "TestAgencyMembers",
      members: [makeAgent("tam-member-a"), makeAgent("tam-member-b"), makeAgent("tam-member-c")],
    });

    const disconnect = agency.connect(bus);
    await flush();

    assert.ok(agentActives.includes("tam-member-a"));
    assert.ok(agentActives.includes("tam-member-b"));
    assert.ok(agentActives.includes("tam-member-c"));

    disconnect();
    bus.unsubscribe("agent-active-spy");
  });

  it("disconnect() emits agency.dormant and all agent.dormant signals", async () => {
    const dormantSources: string[] = [];

    bus.subscribe({
      id: "dormant-spy",
      signals: ["agency.dormant", "agent.dormant"],
      onSignal: (e) => dormantSources.push(e.source),
    });

    const agency = new Agency({
      id: "test-agency-disconnect",
      name: "TestAgencyDisconnect",
      members: [makeAgent("tad-member-a"), makeAgent("tad-member-b")],
    });

    const disconnect = agency.connect(bus);
    await flush();
    disconnect();
    await flush();

    assert.ok(dormantSources.includes("test-agency-disconnect"), "agency.dormant expected");
    assert.ok(dormantSources.includes("tad-member-a"), "agent.dormant for member-a expected");
    assert.ok(dormantSources.includes("tad-member-b"), "agent.dormant for member-b expected");

    bus.unsubscribe("dormant-spy");
  });

  it("one polyneme reaches all subscribing members simultaneously", async () => {
    const activations: string[] = [];

    const agency = new Agency({
      id: "test-agency-fanout",
      name: "TestAgencyFanout",
      members: [
        new Agent({ id: "fanout-a", name: "FanoutA", systemPrompt: "", signals: ["fanout.test"],
          handler: () => { activations.push("fanout-a"); return { emit: [] }; } }),
        new Agent({ id: "fanout-b", name: "FanoutB", systemPrompt: "", signals: ["fanout.test"],
          handler: () => { activations.push("fanout-b"); return { emit: [] }; } }),
        new Agent({ id: "fanout-c", name: "FanoutC", systemPrompt: "", signals: ["fanout.test"],
          handler: () => { activations.push("fanout-c"); return { emit: [] }; } }),
      ],
    });

    const disconnect = agency.connect(bus);
    await flush();

    bus.emit({ source: "test", signal: "fanout.test", type: "polyneme", payload: {}, causedBy: null });
    await flush();

    assert.ok(activations.includes("fanout-a"));
    assert.ok(activations.includes("fanout-b"));
    assert.ok(activations.includes("fanout-c"));
    assert.equal(activations.length, 3);

    disconnect();
  });

  it("nested agency: connecting parent connects grandchildren", async () => {
    const actives: string[] = [];

    bus.subscribe({
      id: "nested-active-spy",
      signals: ["agent.active", "agency.active"],
      onSignal: (e) => actives.push(e.source),
    });

    const innerAgency = new Agency({
      id: "inner-agency",
      name: "InnerAgency",
      members: [makeAgent("nested-agent-a"), makeAgent("nested-agent-b")],
    });

    const outerAgency = new Agency({
      id: "outer-agency",
      name: "OuterAgency",
      members: [innerAgency, makeAgent("nested-agent-c")],
    });

    const disconnect = outerAgency.connect(bus);
    await flush();

    // All three leaf agents connected
    assert.ok(actives.includes("nested-agent-a"));
    assert.ok(actives.includes("nested-agent-b"));
    assert.ok(actives.includes("nested-agent-c"));
    // Both agencies emitted agency.active
    assert.ok(actives.includes("inner-agency"));
    assert.ok(actives.includes("outer-agency"));

    disconnect();
    bus.unsubscribe("nested-active-spy");
  });

  it("a throwing member does not prevent other members from connecting", async () => {
    const errors: string[] = [];
    const actives: string[] = [];

    bus.subscribe({
      id: "err-spy",
      signals: ["agency.member.error"],
      onSignal: (e) => errors.push(e.payload["memberId"] as string),
    });
    bus.subscribe({
      id: "active-spy2",
      signals: ["agent.active"],
      onSignal: (e) => actives.push(e.source),
    });

    // A Connectable that throws on connect
    const badMember: Connectable = {
      id: "bad-member",
      name: "BadMember",
      capability: "deterministic",
      connect: () => { throw new Error("connect failed"); },
    };

    const agency = new Agency({
      id: "test-agency-error",
      name: "TestAgencyError",
      members: [badMember, makeAgent("good-member-a"), makeAgent("good-member-b")],
    });

    const disconnect = agency.connect(bus);
    await flush();

    assert.ok(errors.includes("bad-member"), "agency.member.error should report bad-member");
    assert.ok(actives.includes("good-member-a"), "good-member-a should still connect");
    assert.ok(actives.includes("good-member-b"), "good-member-b should still connect");

    disconnect();
    bus.unsubscribe("err-spy");
    bus.unsubscribe("active-spy2");
  });

  it("capability defaults to highest member tier", () => {
    const agency = new Agency({
      id: "cap-agency",
      name: "CapAgency",
      members: [
        makeAgent("cap-det"),                          // deterministic (has handler)
        new Agent({ id: "cap-llm", name: "CapLLM",
          systemPrompt: "", signals: ["*"] }),          // reasoner (no handler)
        new Agent({ id: "cap-plan", name: "CapPlan",
          systemPrompt: "", signals: ["*"],
          capability: "planner" }),
      ],
    });

    assert.equal(agency.capability, "planner");
  });

  it("capability can be overridden explicitly", () => {
    const agency = new Agency({
      id: "cap-override-agency",
      name: "CapOverride",
      members: [makeAgent("co-member")],
      capability: "synthesizer",
    });

    assert.equal(agency.capability, "synthesizer");
  });
});
