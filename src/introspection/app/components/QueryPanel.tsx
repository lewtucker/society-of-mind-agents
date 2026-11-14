"use client";

import { useState } from "react";
import type { KLineData, ScoredKLine } from "../lib/KLineReader";

// ─── Types ────────────────────────────────────────────────────────────────────

type QueryType = "ACTIVATION_QUERY" | "CAUSAL_TRACE" | "MEMORY_PROBE" | "CENSOR_CHECK" | "REASONING_PROBE";

interface AgentState { id: string; state: "active" | "dormant" }
interface ChainEvent  { id: string; timestamp: number; source: string; signal: string; causedBy: string | null }

type QueryResponse =
  | { type: "ACTIVATION_QUERY"; agents: AgentState[] }
  | { type: "CAUSAL_TRACE"; chain: ChainEvent[]; eventId: string; complete: boolean }
  | { type: "MEMORY_PROBE"; situation: string; klines: ScoredKLine[]; stub: boolean; note?: string }
  | { type: "CENSOR_CHECK"; agentId: string; action: string; wouldFire: boolean; matchingCensors: ScoredKLine[]; stub: boolean; note?: string }
  | { type: string; stub: true; note?: string }
  | { error: string };

// ─── Helpers ─────────────────────────────────────────────────────────────────

const QUERY_LABELS: Record<QueryType, string> = {
  ACTIVATION_QUERY: "Activation State",
  CAUSAL_TRACE:     "Causal Trace",
  MEMORY_PROBE:     "Memory Probe",
  CENSOR_CHECK:     "Censor Check",
  REASONING_PROBE:  "Reasoning Probe",
};

const QUERY_DESCRIPTIONS: Record<QueryType, string> = {
  ACTIVATION_QUERY: "Which agents and agencies are currently active or dormant?",
  CAUSAL_TRACE:     "Walk the causedBy chain back to the root for an event ID.",
  MEMORY_PROBE:     "What K-lines match a situation description?",
  CENSOR_CHECK:     "Would any censor fire for a proposed action in this situation?",
  REASONING_PROBE:  "How would an agent respond to a signal? (requires live agent)",
};

function timeStr(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", {
    hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function dateStr(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ─── Band pill ────────────────────────────────────────────────────────────────

function BandPill({ band, agents }: { band: "core" | "peripheral" | "fringe"; agents: string[] }) {
  if (agents.length === 0) return null;
  return (
    <div className={`flex items-center gap-1.5 rounded border px-2 py-0.5 font-mono text-xs som-band-${band}`}>
      <span className="font-semibold">{band}</span>
      <span>·</span>
      <span className="truncate">{agents.join(", ")}</span>
    </div>
  );
}

// ─── K-line card ──────────────────────────────────────────────────────────────

function KLineCard({ item }: { item: ScoredKLine }) {
  const { kline, score } = item;
  const typeLabel: Record<string, string> = {
    positive:   "✓",
    censor:     "✗",
    suppressor: "⊘",
    abstract:   "◈",
  };

  return (
    <div className={`rounded border p-3 space-y-2 som-kline-${kline.type}`}>
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`font-mono text-sm font-bold shrink-0 som-kline-label-${kline.type}`}>
            {typeLabel[kline.type] ?? "?"}
          </span>
          <span className="font-mono text-xs som-text-muted truncate">{kline.situation_desc}</span>
        </div>
        <span className="shrink-0 font-mono text-xs som-text-accent tabular-nums">
          {(score * 100).toFixed(0)}%
        </span>
      </div>

      {/* Bands */}
      <div className="flex flex-wrap gap-1.5">
        <BandPill band="core"       agents={kline.bands.core?.agents ?? []} />
        <BandPill band="peripheral" agents={kline.bands.peripheral?.agents ?? []} />
        <BandPill band="fringe"     agents={kline.bands.fringe?.agents ?? []} />
      </div>

      {/* Censor guard */}
      {kline.guard && (
        <div className="som-censor-box rounded border px-2 py-1.5 font-mono text-xs space-y-0.5">
          <div><span className="som-censor-box-label">blocks:</span> {kline.guard.blocked_action}</div>
          <div className="som-censor-box-desc text-xs leading-tight">{kline.guard.outcome_description}</div>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center gap-3 font-mono text-xs som-text-secondary">
        <span>{dateStr(kline.created_at)}</span>
        {kline.task_id && <span>task: {kline.task_id}</span>}
        {kline.retrieval_count > 0 && <span>retrieved ×{kline.retrieval_count}</span>}
      </div>
    </div>
  );
}

// ─── Result renderers ─────────────────────────────────────────────────────────

function ActivationResult({ agents }: { agents: AgentState[] }) {
  if (agents.length === 0) {
    return <p className="font-mono text-xs som-text-primary">No agents found in log.</p>;
  }
  const active  = agents.filter((a) => a.state === "active");
  const dormant = agents.filter((a) => a.state === "dormant");
  return (
    <div className="space-y-3">
      {active.length > 0 && (
        <div>
          <div className="mb-1 font-mono text-xs font-semibold som-text-success">Active ({active.length})</div>
          <div className="space-y-0.5">
            {active.map((a) => (
              <div key={a.id} className="flex items-center gap-2 font-mono text-xs">
                <span className="h-1.5 w-1.5 rounded-full som-dot-active animate-pulse" />
                <span className="som-text-success">{a.id}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {dormant.length > 0 && (
        <div>
          <div className="mb-1 font-mono text-xs font-semibold som-text-primary">Dormant ({dormant.length})</div>
          <div className="space-y-0.5">
            {dormant.map((a) => (
              <div key={a.id} className="flex items-center gap-2 font-mono text-xs">
                <span className="h-1.5 w-1.5 rounded-full som-dot-dormant" />
                <span className="som-text-primary">{a.id}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CausalTraceResult({ chain, complete }: { chain: ChainEvent[]; complete: boolean }) {
  if (chain.length === 0) {
    return <p className="font-mono text-xs som-text-primary">Event not found in log.</p>;
  }
  return (
    <div className="space-y-0">
      {chain.map((ev, i) => (
        <div key={ev.id} className="flex items-start gap-2">
          <div className="flex flex-col items-center">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full som-trace-dot" />
            {i < chain.length - 1 && <span className="mt-0.5 w-px flex-1 som-trace-line" style={{ minHeight: "16px" }} />}
          </div>
          <div className="pb-2 font-mono text-xs">
            <span className="som-text-muted">{timeStr(ev.timestamp)}</span>
            {" · "}
            <span className="som-text-primary">{ev.source}</span>
            {" · "}
            <span className="som-trace-signal">{ev.signal}</span>
            <div className="mt-0.5 som-text-muted text-xs leading-tight">{ev.id}</div>
          </div>
        </div>
      ))}
      <div className="mt-1 font-mono text-xs som-text-muted">
        {complete ? `${chain.length} event${chain.length !== 1 ? "s" : ""} — root reached` : "chain incomplete"}
      </div>
    </div>
  );
}

function MemoryProbeResult({ data }: { data: { situation: string; klines: ScoredKLine[]; stub: boolean; note?: string } }) {
  if (data.stub) {
    return <p className="font-mono text-xs som-text-warning">{data.note ?? "K-line store not available."}</p>;
  }
  if (data.klines.length === 0) {
    return <p className="font-mono text-xs som-text-primary">No matching K-lines found.</p>;
  }
  return (
    <div className="space-y-2">
      <p className="font-mono text-xs som-text-primary">{data.klines.length} K-line{data.klines.length !== 1 ? "s" : ""} retrieved</p>
      {data.klines.map((item, i) => (
        <KLineCard key={item.kline.id ?? i} item={item} />
      ))}
    </div>
  );
}

function CensorCheckResult({ data }: { data: { wouldFire: boolean; matchingCensors: ScoredKLine[]; stub: boolean; note?: string } }) {
  if (data.stub) {
    return <p className="font-mono text-xs som-text-warning">{data.note ?? "K-line store not available."}</p>;
  }
  return (
    <div className="space-y-2">
      <div className={`flex items-center gap-2 font-mono text-sm font-semibold ${data.wouldFire ? "som-text-error" : "som-text-success"}`}>
        <span>{data.wouldFire ? "⚠ CENSOR FIRES" : "✓ Clear"}</span>
      </div>
      {data.wouldFire && data.matchingCensors.length > 0 && (
        <div className="space-y-2">
          <p className="font-mono text-xs som-text-error">{data.matchingCensors.length} matching censor{data.matchingCensors.length !== 1 ? "s" : ""}:</p>
          {data.matchingCensors.map((item, i) => (
            <KLineCard key={item.kline.id ?? i} item={item} />
          ))}
        </div>
      )}
      {!data.wouldFire && (
        <p className="font-mono text-xs som-text-primary">No censors match this situation + action.</p>
      )}
    </div>
  );
}

function StubResult({ note }: { note?: string }) {
  return (
    <p className="font-mono text-xs som-text-warning">
      {note ?? "Not yet implemented — available in a later phase."}
    </p>
  );
}

// ─── QueryPanel ───────────────────────────────────────────────────────────────

export default function QueryPanel() {
  const [queryType, setQueryType] = useState<QueryType>("ACTIVATION_QUERY");
  const [eventId,   setEventId]   = useState("");
  const [situation, setSituation] = useState("");
  const [action,    setAction]    = useState("");
  const [loading,   setLoading]   = useState(false);
  const [result,    setResult]    = useState<QueryResponse | null>(null);

  const needsEventId   = queryType === "CAUSAL_TRACE";
  const needsSituation = queryType === "MEMORY_PROBE" || queryType === "CENSOR_CHECK";
  const needsAction    = queryType === "CENSOR_CHECK";

  function isRunnable() {
    if (loading) return false;
    if (needsEventId && !eventId.trim()) return false;
    if (needsSituation && !situation.trim()) return false;
    if (needsAction && !action.trim()) return false;
    return true;
  }

  async function runQuery() {
    setLoading(true);
    setResult(null);
    try {
      const body: Record<string, string> = { type: queryType };
      if (needsEventId)   body.eventId   = eventId.trim();
      if (needsSituation) body.situation  = situation.trim();
      if (needsAction)    body.action     = action.trim();

      const res = await fetch("/api/query", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      });
      setResult(await res.json() as QueryResponse);
    } catch (err) {
      setResult({ error: String(err) });
    } finally {
      setLoading(false);
    }
  }

  function renderResult() {
    if (!result) return null;
    if ("error" in result) {
      return <p className="font-mono text-xs som-text-error">{result.error}</p>;
    }
    if (result.type === "ACTIVATION_QUERY" && "agents" in result) {
      return <ActivationResult agents={result.agents} />;
    }
    if (result.type === "CAUSAL_TRACE" && "chain" in result) {
      return <CausalTraceResult chain={result.chain} complete={result.complete} />;
    }
    if (result.type === "MEMORY_PROBE" && "klines" in result) {
      return <MemoryProbeResult data={result} />;
    }
    if (result.type === "CENSOR_CHECK" && "wouldFire" in result) {
      return <CensorCheckResult data={result} />;
    }
    if ("stub" in result && result.stub) {
      return <StubResult note={"note" in result ? result.note : undefined} />;
    }
    return <pre className="font-mono text-xs som-text-muted whitespace-pre-wrap">{JSON.stringify(result, null, 2)}</pre>;
  }

  return (
    <div className="border-t som-border pt-6">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-widest som-text-primary">
          Query Interface
        </span>
        <div className="h-px flex-1 som-divider" />
      </div>

      <div className="flex flex-col gap-2">
        {/* Query type selector */}
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(QUERY_LABELS) as QueryType[]).map((qt) => (
            <button
              key={qt}
              onClick={() => { setQueryType(qt); setResult(null); }}
              className={`rounded border px-2 py-1 font-mono text-xs transition-colors ${
                queryType === qt ? "som-btn-active" : "som-btn"
              }`}
            >
              {QUERY_LABELS[qt]}
            </button>
          ))}
        </div>

        {/* Description */}
        <p className="font-mono text-xs som-text-primary">{QUERY_DESCRIPTIONS[queryType]}</p>

        {/* Event ID input */}
        {needsEventId && (
          <input
            type="text"
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") runQuery(); }}
            placeholder="Event ID (ULID)…"
            className="som-input rounded border px-3 py-1.5 font-mono text-xs"
          />
        )}

        {/* Situation input */}
        {needsSituation && (
          <textarea
            value={situation}
            onChange={(e) => setSituation(e.target.value)}
            placeholder="Describe the current situation…"
            rows={2}
            className="som-input rounded border px-3 py-1.5 font-mono text-xs resize-none"
          />
        )}

        {/* Action input (CENSOR_CHECK only) */}
        {needsAction && (
          <input
            type="text"
            value={action}
            onChange={(e) => setAction(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") runQuery(); }}
            placeholder="Proposed action (e.g. grasp_block)…"
            className="som-input rounded border px-3 py-1.5 font-mono text-xs"
          />
        )}

        {/* Run button */}
        <button
          onClick={runQuery}
          disabled={!isRunnable()}
          className="self-start som-btn rounded border px-3 py-1.5 font-mono text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? "querying…" : "Run query"}
        </button>

        {/* Result */}
        {result && (
          <div className="mt-1 som-result rounded border p-3">
            {renderResult()}
          </div>
        )}
      </div>
    </div>
  );
}
