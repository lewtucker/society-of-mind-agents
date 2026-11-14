"use client";

import { useEffect, useState } from "react";
import type { KLineData } from "../lib/KLineReader";
import {
  KLINE_FILL, KLINE_STROKE,
  BAND_STROKE, BAND_WIDTH, BAND_DASH,
  AGENT_FILL_ACTIVE, AGENT_FILL_DORMANT,
  AGENT_STROKE_ACTIVE, AGENT_STROKE_DORMANT,
  COLOR_TEXT_PRIMARY,
} from "../theme";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AgentState { id: string; state: "active" | "dormant" }

interface GraphData {
  klines:      KLineData[];
  agentStates: AgentState[];
  hasKLines:   boolean;
}

// ─── Layout constants ─────────────────────────────────────────────────────────

const NODE_R     = 18;
const HEX_R      = 16;
const COL_AGENT  = 100;
const COL_KLINE  = 460;
const ROW_H      = 56;
const PAD_TOP    = 40;
const SVG_WIDTH  = 580;

// ─── Geometry helpers ─────────────────────────────────────────────────────────

function hexPoints(cx: number, cy: number, r: number): string {
  return Array.from({ length: 6 }, (_, i) => {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    return `${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`;
  }).join(" ");
}

function shortenLine(x1: number, y1: number, x2: number, y2: number, d: number) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len <= d * 2) return { x1, y1, x2, y2 };
  const ux = dx / len, uy = dy / len;
  return { x1: x1 + ux * d, y1: y1 + uy * d, x2: x2 - ux * d, y2: y2 - uy * d };
}

function truncate(s: string, n: number) {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

// ─── Graph builder ────────────────────────────────────────────────────────────

interface AgentNode { id: string; y: number; state: "active" | "dormant" }
interface KLineNode  { id: string; y: number; type: string; desc: string }
interface Edge       { agentId: string; klineId: string; band: "core" | "peripheral" | "fringe" }

function buildGraph(data: GraphData): { agents: AgentNode[]; klines: KLineNode[]; edges: Edge[]; height: number } {
  const stateMap = new Map(data.agentStates.map((a) => [a.id, a.state]));

  const agentSet = new Set<string>();
  const edges: Edge[] = [];

  for (const kline of data.klines) {
    for (const band of ["core", "peripheral", "fringe"] as const) {
      for (const agentId of kline.bands[band]?.agents ?? []) {
        agentSet.add(agentId);
        edges.push({ agentId, klineId: kline.id, band });
      }
    }
  }

  const agentIds  = Array.from(agentSet).sort();
  const agents: AgentNode[] = agentIds.map((id, i) => ({
    id,
    y:     PAD_TOP + i * ROW_H,
    state: stateMap.get(id) ?? "dormant",
  }));

  const klines: KLineNode[] = data.klines.map((kl, i) => ({
    id:   kl.id,
    y:    PAD_TOP + i * ROW_H,
    type: kl.type,
    desc: kl.situation_desc,
  }));

  const rows   = Math.max(agents.length, klines.length, 1);
  const height = PAD_TOP + rows * ROW_H + PAD_TOP;

  return { agents, klines, edges, height };
}

// ─── SVG Graph ────────────────────────────────────────────────────────────────

function GraphSVG({ data }: { data: GraphData }) {
  const { agents, klines, edges, height } = buildGraph(data);

  const agentYMap = new Map(agents.map((a) => [a.id, a.y]));
  const klineYMap = new Map(klines.map((k) => [k.id, k.y]));

  return (
    <svg
      width={SVG_WIDTH}
      height={height}
      className="w-full"
      style={{ maxWidth: SVG_WIDTH }}
      aria-label="Memory Feedback Graph"
    >
      {/* Column labels */}
      <text x={COL_AGENT} y={16} textAnchor="middle" fontSize={9} fill={COLOR_TEXT_PRIMARY} fontFamily="monospace" letterSpacing="0.1em">
        AGENTS
      </text>
      <text x={COL_KLINE} y={16} textAnchor="middle" fontSize={9} fill={COLOR_TEXT_PRIMARY} fontFamily="monospace" letterSpacing="0.1em">
        K-LINES
      </text>

      {/* Edges */}
      {edges.map((e, i) => {
        const ay = agentYMap.get(e.agentId);
        const ky = klineYMap.get(e.klineId);
        if (ay === undefined || ky === undefined) return null;
        const { x1, y1, x2, y2 } = shortenLine(COL_AGENT, ay, COL_KLINE, ky, NODE_R + 4);
        return (
          <line
            key={i}
            x1={x1} y1={y1} x2={x2} y2={y2}
            stroke={BAND_STROKE[e.band]}
            strokeWidth={BAND_WIDTH[e.band]}
            strokeDasharray={BAND_DASH[e.band]}
            opacity={0.55}
          />
        );
      })}

      {/* Agent nodes */}
      {agents.map((a) => (
        <g key={a.id} transform={`translate(${COL_AGENT},${a.y})`}>
          <circle
            r={NODE_R}
            fill={a.state === "active" ? AGENT_FILL_ACTIVE : AGENT_FILL_DORMANT}
            stroke={a.state === "active" ? AGENT_STROKE_ACTIVE : AGENT_STROKE_DORMANT}
            strokeWidth={1.5}
          />
          {a.state === "active" && (
            <circle r={NODE_R + 4} fill="none" stroke={AGENT_STROKE_ACTIVE} strokeWidth={0.5} opacity={0.3} />
          )}
          <text
            y={NODE_R + 12}
            textAnchor="middle"
            fontSize={8}
            fill={COLOR_TEXT_PRIMARY}
            fontFamily="monospace"
          >
            {truncate(a.id.replace(/-agent$/, ""), 14)}
          </text>
        </g>
      ))}

      {/* K-line nodes (hexagons) */}
      {klines.map((kl) => (
        <g key={kl.id} transform={`translate(${COL_KLINE},${kl.y})`}>
          <polygon
            points={hexPoints(0, 0, HEX_R)}
            fill={KLINE_FILL[kl.type] ?? "#f9fafb"}
            stroke={KLINE_STROKE[kl.type] ?? "#374151"}
            strokeWidth={1.5}
          />
          <text
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={10}
            fill={KLINE_STROKE[kl.type] ?? "#9ca3af"}
            fontFamily="monospace"
            fontWeight="bold"
          >
            {kl.type === "positive" ? "+" : kl.type === "censor" ? "✗" : kl.type === "abstract" ? "◈" : "⊘"}
          </text>
          <text
            x={HEX_R + 8}
            dominantBaseline="central"
            fontSize={8}
            fill={COLOR_TEXT_PRIMARY}
            fontFamily="monospace"
          >
            {truncate(kl.desc, 28)}
          </text>
        </g>
      ))}

      {/* Empty state */}
      {klines.length === 0 && (
        <text x={SVG_WIDTH / 2} y={height / 2} textAnchor="middle" fontSize={11} fill={BAND_STROKE.fringe} fontFamily="monospace">
          No K-lines yet — run the society to build memory.
        </text>
      )}
    </svg>
  );
}

// ─── Legend ───────────────────────────────────────────────────────────────────

function Legend() {
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-1.5 font-mono text-xs som-text-primary">
      <div className="flex items-center gap-1.5">
        <svg width={20} height={14}><line x1={2} y1={7} x2={18} y2={7} stroke={BAND_STROKE.core} strokeWidth={BAND_WIDTH.core} /></svg>
        <span>core</span>
      </div>
      <div className="flex items-center gap-1.5">
        <svg width={20} height={14}><line x1={2} y1={7} x2={18} y2={7} stroke={BAND_STROKE.peripheral} strokeWidth={BAND_WIDTH.peripheral} /></svg>
        <span>peripheral</span>
      </div>
      <div className="flex items-center gap-1.5">
        <svg width={20} height={14}><line x1={2} y1={7} x2={18} y2={7} stroke={BAND_STROKE.fringe} strokeWidth={BAND_WIDTH.fringe} strokeDasharray={BAND_DASH.fringe} /></svg>
        <span>fringe</span>
      </div>
      <div className="flex items-center gap-1.5">
        <svg width={16} height={16}><circle cx={8} cy={8} r={6} fill={AGENT_FILL_ACTIVE} stroke={AGENT_STROKE_ACTIVE} strokeWidth={1.5} /></svg>
        <span>active agent</span>
      </div>
      <div className="flex items-center gap-1.5">
        <svg width={20} height={20}>
          <polygon points={hexPoints(10, 10, 8)} fill={KLINE_FILL.positive} stroke={KLINE_STROKE.positive} strokeWidth={1.5} />
        </svg>
        <span>positive K-line</span>
      </div>
      <div className="flex items-center gap-1.5">
        <svg width={20} height={20}>
          <polygon points={hexPoints(10, 10, 8)} fill={KLINE_FILL.censor} stroke={KLINE_STROKE.censor} strokeWidth={1.5} />
        </svg>
        <span>censor K-line</span>
      </div>
    </div>
  );
}

// ─── MemoryFeedbackGraph ──────────────────────────────────────────────────────

export default function MemoryFeedbackGraph() {
  const [data,    setData]    = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/klines")
      .then((r) => r.json())
      .then((d) => { setData(d as GraphData); setLoading(false); })
      .catch((e) => { setError(String(e)); setLoading(false); });
  }, []);

  return (
    <div className="border-t som-border pt-6">
      {/* Header */}
      <div className="mb-3 flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-widest som-text-primary">
          Memory Feedback Graph
        </span>
        <div className="h-px flex-1 som-divider" />
        {data && (
          <span className="font-mono text-xs som-text-primary">
            {data.klines.length} K-line{data.klines.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {loading && (
        <p className="font-mono text-xs som-text-primary">Loading memory…</p>
      )}

      {error && (
        <p className="font-mono text-xs som-text-error">{error}</p>
      )}

      {data && !data.hasKLines && (
        <p className="font-mono text-xs som-text-primary">
          No K-line store found at ~/.som/klines.db — start the society to build memory.
        </p>
      )}

      {data && data.hasKLines && (
        <div className="space-y-3 overflow-x-auto">
          <Legend />
          <div className="min-w-0 rounded border som-border-strong som-panel p-2">
            <GraphSVG data={data} />
          </div>
        </div>
      )}
    </div>
  );
}
