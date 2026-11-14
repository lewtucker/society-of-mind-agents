"use client";

import { useEffect, useRef, useState } from "react";
import { AGENTS } from "../lib/scenario";
import type { AgentDef, AgentState, AgentStatus, SignalType, Snapshot, SocietyEvent } from "../types";
import QueryPanel from "./QueryPanel";
import MemoryFeedbackGraph from "./MemoryFeedbackGraph";
import AdminPanel from "./AdminPanel";

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_EVENTS = 50;

const LAYER_LABELS: Record<string, string> = {
  "b-brain": "B-Brain Layer",
  agency:    "Agency Layer",
  agent:     "Agent Layer",
};

const LAYER_ORDER = ["b-brain", "agency", "agent"];

// ─── Styles ───────────────────────────────────────────────────────────────────

function stateStyle(state: AgentState): string {
  switch (state) {
    case "active":   return "som-agent-active";
    case "conflict": return "som-agent-conflict";
    case "watching": return "som-agent-watching";
    default:         return "som-agent-dormant";
  }
}

function stateDotStyle(state: AgentState): string {
  switch (state) {
    case "active":   return "som-dot-active animate-pulse";
    case "conflict": return "som-dot-conflict animate-pulse";
    case "watching": return "som-dot-watching";
    default:         return "som-dot-dormant";
  }
}

function signalTypeColor(type: SignalType): string {
  switch (type) {
    case "polyneme":     return "som-sig-polyneme";
    case "isonome":      return "som-sig-isonome";
    case "activation":   return "som-sig-activation";
    case "censor":       return "som-sig-censor";
    case "pronome-bind": return "som-sig-pronome";
    case "tool_intent":  return "som-sig-tool";
    default:             return "som-text-primary";
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function AgentCard({ def, status }: { def: AgentDef; status: AgentStatus | undefined }) {
  const state = status?.state ?? "dormant";
  return (
    <div
      className={`rounded-lg border p-3 transition-all duration-300 ${stateStyle(state)}`}
      title={def.description}
    >
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${stateDotStyle(state)}`} />
        <span className="truncate font-mono text-sm font-medium">{def.name}</span>
      </div>
      {status?.lastSignal && state === "active" && (
        <div className="mt-1.5 truncate font-mono text-xs som-text-success">
          {status.lastSignal}
        </div>
      )}
      <div className="mt-1 text-xs som-text-muted">
        {status?.activationCount ? `×${status.activationCount}` : "–"}
      </div>
    </div>
  );
}

function LayerSection({
  layer,
  agents,
  statuses,
}: {
  layer: string;
  agents: AgentDef[];
  statuses: Record<string, AgentStatus>;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-widest som-text-primary">
          {LAYER_LABELS[layer]}
        </span>
        <div className="h-px flex-1 som-divider" />
      </div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {agents.map((def) => (
          <AgentCard key={def.id} def={def} status={statuses[def.id]} />
        ))}
      </div>
    </div>
  );
}

function EventRow({ ev }: { ev: SocietyEvent }) {
  const time = new Date(ev.timestamp).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return (
    <div className="som-row border-b px-3 py-2">
      <div className="flex items-baseline gap-2">
        <span className="shrink-0 font-mono text-xs som-text-muted">{time}</span>
        <span className="font-mono text-xs som-text-primary font-medium">{ev.source}</span>
        <span className={`font-mono text-xs font-bold ${signalTypeColor(ev.type)}`}>
          {ev.signal}
        </span>
      </div>
      <div className="mt-0.5 pl-0 font-mono text-xs som-text-muted leading-snug">
        {ev.summary}
      </div>
      <div className="mt-0.5 font-mono text-xs som-text-muted opacity-50 select-all truncate">
        {ev.id}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

async function postDemo(action: "step" | "reset") {
  await fetch(`/api/demo/${action}`, { method: "POST" });
}

export default function SocietyView() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [events, setEvents] = useState<SocietyEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events.length]);

  useEffect(() => {
    const es = new EventSource("/api/events");

    es.onopen = () => setConnected(true);

    es.onmessage = (e) => {
      const snap: Snapshot = JSON.parse(e.data);
      setSnapshot(snap);
      if (snap.event) {
        setEvents((prev) => {
          const next = [...prev, snap.event!];
          return next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next;
        });
      }
    };

    es.onerror = () => setConnected(false);

    return () => es.close();
  }, []);

  const agentsByLayer = LAYER_ORDER.map((layer) => ({
    layer,
    agents: AGENTS.filter((a) => a.layer === layer),
  }));

  const statuses = snapshot?.statuses ?? {};
  const activeCount = Object.values(statuses).filter((s) => s.state === "active").length;

  return (
    <div className="flex h-screen flex-col som-page">
      {/* Header */}
      <header className="flex shrink-0 items-center justify-between border-b som-border-strong som-panel px-6 py-3">
        <div className="flex items-center gap-3">
          <span className="font-mono text-base font-semibold tracking-tight som-text-primary">
            Society of Mind
          </span>
          <span className="som-text-secondary">·</span>
          <span className="font-mono text-sm som-text-secondary">Introspection</span>
        </div>
        <div className="flex items-center gap-4">
          {activeCount > 0 && (
            <span className="font-mono text-xs som-text-success">
              {activeCount} active
            </span>
          )}
          {snapshot?.isDemo && (
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs som-text-muted">
                step {(snapshot.demoFrame ?? 0) + 1} / {snapshot.demoTotal ?? "?"}
              </span>
              <button
                onClick={() => postDemo("step")}
                disabled={(snapshot.demoFrame ?? 0) >= (snapshot.demoTotal ?? 0) - 1}
                className="som-btn rounded border px-2.5 py-0.5 font-mono text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next Step →
              </button>
              <button
                onClick={async () => { await postDemo("reset"); setEvents([]); }}
                className="som-btn rounded border px-2.5 py-0.5 font-mono text-xs transition-colors"
              >
                Reset
              </button>
            </div>
          )}
          <span className="som-mode-badge rounded border px-2.5 py-0.5 font-mono text-xs font-semibold">
            {snapshot?.mode ?? "OBSERVE"}
          </span>
          <div className="flex items-center gap-1.5">
            <span
              className={`h-2 w-2 rounded-full ${
                !connected ? "bg-gray-400" :
                snapshot?.paused ? "bg-amber-500" :
                "animate-pulse bg-green-500"
              }`}
            />
            <span className="font-mono text-xs som-text-primary">
              {!connected ? "connecting…" : snapshot?.paused ? "paused — run complete" : "live"}
            </span>
          </div>
        </div>
      </header>

      <AdminPanel />

      {/* Body */}
      <div className="flex min-h-0 flex-1">
        {/* Agent grid + query panel — left panel */}
        <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-6">
          {agentsByLayer.map(({ layer, agents }) => (
            <LayerSection
              key={layer}
              layer={layer}
              agents={agents}
              statuses={statuses}
            />
          ))}
          <MemoryFeedbackGraph />
          <QueryPanel />
        </div>

        {/* Event feed — right panel */}
        <div className="flex w-80 shrink-0 flex-col border-l som-border-strong som-panel overflow-hidden xl:w-96">
          <div className="shrink-0 border-b som-border-strong px-4 py-2">
            <span className="font-mono text-xs font-semibold uppercase tracking-widest som-text-primary">
              Event Feed
            </span>
          </div>
          <div
            ref={feedRef}
            className="flex-1 overflow-y-auto"
          >
            {events.length === 0 ? (
              <div className="px-4 py-6 font-mono text-xs som-text-muted">
                Waiting for signals…
              </div>
            ) : (
              events.map((ev) => (
                <EventRow key={ev.id} ev={ev} />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
