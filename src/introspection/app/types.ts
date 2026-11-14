export type AgentState = "dormant" | "active" | "conflict" | "watching";
export type AgentLayer = "b-brain" | "agency" | "agent";
export type SignalType = "polyneme" | "isonome" | "activation" | "censor" | "pronome-bind" | "tool_intent";
export type SocietyMode = "OBSERVE" | "ACT";

export interface AgentDef {
  id: string;
  name: string;
  layer: AgentLayer;
  description: string;
}

export interface AgentStatus {
  agentId: string;
  state: AgentState;
  lastSignal: string | null;
  activationCount: number;
}

export interface SocietyEvent {
  id: string;
  timestamp: number;
  source: string;
  signal: string;
  type: SignalType;
  summary: string;
  causedBy: string | null;
}

export interface Snapshot {
  mode: SocietyMode;
  statuses: Record<string, AgentStatus>;
  event: SocietyEvent | null;
  tick: number;
  paused: boolean;
  isDemo?: boolean;
  demoFrame?: number;
  demoTotal?: number;
}
