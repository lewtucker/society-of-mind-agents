---
title: "Observability, Query Interface, and Action Control"
version: "1.0"
date: 2026-04-01
author: Lew Tucker
status: Draft
document-id: SOM-OBS
changelog:
  - version: "1.0"
    date: 2026-04-01
    summary: Initial draft — two operating modes, query interface, nanaclaw-derived control patterns
---

# Observability, Query Interface, and Action Control

This document specifies three concerns that were latent in the original architecture but are now first-class:

1. **Observability** — watching the society in real time
2. **Query interface** — asking the society what it knows/thinks without triggering actions
3. **Action control** — gating what the society is allowed to do, with a clear OBSERVE → ACT progression

This document supplements `ARCHITECTURE.md` (introspection app design) and draws on control patterns from the nanoclaw project.

---

## 1. Why This Changes the Build Order

The original Phase 1 plan was: Agent base class → Agency container → Polyneme bus → Context store.

That plan assumed agents and the bus are built together, with observability added later. **This was wrong.** Two reasons:

**Reason 1 — You can't validate memory without observation.**
The central research question (FEASIBILITY.md §7) is: *does K-line retrieval actually produce better behavior than bare LLM context?* You can't answer that question without being able to see what K-lines are retrieved, with what confidence, and what agents they activate. If you build agents first, you're flying blind.

**Reason 2 — OBSERVE mode is safer for early development.**
Agents in containers can reason, emit signals to each other, and use the K-line system without touching anything in the world. You should be able to run the society for weeks in OBSERVE mode — asking it questions, watching it reason, accumulating memories — before ever enabling ACT mode. This dramatically reduces the risk of early mistakes.

### Revised build order

```
Phase 0: Observation Foundation (before any agents)
  0.1  Event log (append-only, ULID-ordered)
  0.2  Polyneme bus with OBSERVE mode gate
  0.3  Introspection app (reads event log, nothing else)

Phase 1: Foundation (now safe to build — introspection from day 1)
  1.1  Agent base class (OBSERVE mode: tools intercepted, returns "would do X")
  1.2  Agency container
  1.3  Context store (pronomes, micronemes, frame reference)
  1.4  Query interface (ask the society a question)

Phase 2: Memory (validate with query interface before proceeding)
  2.1  K-line schema + SQLite storage
  2.2  Positive capture + retrieval
  2.3  Censor/suppressor capture + retrieval
  2.4  Memory probe query ("what do you know about X?")

Phase 3+: Knowledge, Goals, Demo (same as original plan)
```

---

## 2. Operating Modes

The society runs in one of two modes. Mode is set globally and enforced by the Polyneme bus and each container's PreToolUse hook.

```typescript
type SocietyMode = "OBSERVE" | "ACT";
```

### OBSERVE mode

- Agents receive signals and reason normally
- Agents can read from K-lines, frames, context store
- Agents CAN emit signals to each other (internal reasoning continues)
- Agents CANNOT execute tools that affect the external world
- Tool calls are intercepted by PreToolUse hook: instead of executing, the hook logs "agent X would have called tool Y with params Z" and returns a simulated no-op result
- K-lines ARE written (memory accumulates even in OBSERVE mode)
- Censor/suppressor entries ARE written
- Everything is logged to the event log

**The system learns in OBSERVE mode.** Running weeks of conversations in OBSERVE mode means the K-line store fills up with real memories before any action is ever taken. When ACT mode is eventually enabled, the society already has context.

### ACT mode

- All OBSERVE mode capabilities, plus:
- Tool calls execute (subject to per-tool approval tiers — see §4)
- External actions can be taken
- Requires explicit mode switch with confirmation

### Mode enforcement: the PreToolUse hook

Every agent container runs with a `PreToolUse` hook (Claude Agent SDK feature, same pattern as nanoclaw's OC Policy integration):

```typescript
// Injected into every agent container's Claude config
hooks: {
  PreToolUse: [{ hooks: [createModeGateHook(societyMode, approvalClient)] }]
}

function createModeGateHook(mode: SocietyMode, approvalClient: ApprovalClient): HookCallback {
  return async (input: unknown) => {
    const { tool_name, tool_input } = input as { tool_name: string; tool_input: unknown };

    if (mode === "OBSERVE") {
      // Log the intent, return simulated no-op
      await eventLog.emit({
        type: "tool_intent",
        tool: tool_name,
        params: tool_input,
        mode: "OBSERVE",
        note: "Intercepted — would have executed in ACT mode"
      });
      // Return a plausible-looking stub result so agent reasoning continues
      return {
        decision: "block",
        reason: `[OBSERVE MODE] Tool ${tool_name} intercepted. Logged intent.`
      };
    }

    // ACT mode: check approval tier
    const tier = getToolTier(tool_name);
    if (tier === "auto_allow") return {};                       // No approval needed
    if (tier === "deny") return { decision: "block", reason: "Tool permanently restricted" };
    
    // tier === "requires_approval": ask human
    const verdict = await approvalClient.check({ tool: tool_name, params: tool_input });
    if (verdict === "allow") return {};
    return { decision: "block", reason: `Denied: ${verdict.reason}` };
  };
}
```

---

## 3. The Query Interface

The query interface is how you talk *to* the society from outside — asking what it knows, what it thinks, or what it would do — without triggering a task loop.

### 3.1 Query types

| Query type | What it does | Example |
|---|---|---|
| `MEMORY_PROBE` | Run K-line retrieval and return what was found | "What do you know about tower-building?" |
| `SITUATION_READ` | Describe what the society currently knows about an ongoing situation | "What's the current state of the goal queue?" |
| `REASONING_PROBE` | Activate agents in OBSERVE mode and return their reasoning | "How would you approach this task?" |
| `CENSOR_CHECK` | Run the censor retrieval pass and report active blocks | "Is anything blocked in this context?" |
| `AGENT_STATUS` | Report which agents are active, dormant, or in conflict | "Who's currently running?" |

### 3.2 Query agent

A dedicated `QueryAgent` is the entry point. It is always in OBSERVE mode regardless of global mode — it never acts, only reports.

```
Query arrives (via CLI, API, or introspection app chat interface)
  │
  ▼
QueryAgent parses the query type and intent
  │
  ├─── MEMORY_PROBE ──► MemoryManager.retrieve(situation_desc) 
  │                      → returns ranked K-lines with confidence + band info
  │
  ├─── REASONING_PROBE ──► Polyneme bus emits query as internal signal
  │                         → relevant agents activate in OBSERVE mode
  │                         → collect all reasoning signals
  │                         → return synthesis
  │
  ├─── CENSOR_CHECK ──► MemoryManager.censorCheck(situation_desc)
  │                      → returns active censors with precursor match confidence
  │
  └─── AGENT_STATUS ──► Context store read
                         → returns current activation state
```

### 3.3 Memory probe output

This is the primary tool for validating that the K-line system works. When you ask "what do you know about X?", the response shows you exactly what the memory system surfaces:

```typescript
interface MemoryProbeResult {
  query: string;
  retrieved_klines: Array<{
    id: string;
    type: "positive" | "censor" | "suppressor" | "abstract";
    situation_description: string;
    similarity_score: number;        // 0-1
    band_summary: {
      core_agents: string[];
      peripheral_agents: string[];
      fringe_agents: string[];
    };
    age_days: number;
    retrieval_count: number;         // How often this K-line has been used before
    is_default_filling: boolean;     // True if this is supplying defaults for unknowns
  }>;
  active_censors: Array<{
    id: string;
    precursor_pattern: string;
    blocked_action: string;
    match_confidence: number;
  }>;
  from_cold_start: boolean;          // True if no K-lines above threshold
  suggested_agent_activations: string[];  // Union of core agents from top-3 K-lines
}
```

This output is shown directly in the introspection app and can be queried via CLI.

---

## 4. Action Tiers (ACT mode only)

When ACT mode is enabled, tools are categorized by risk level. This classification lives in a configuration file **outside** agent containers (following nanoclaw's tamper-proof allowlist pattern):

```
~/.som/policy/tool-tiers.json
```

```json
{
  "tiers": {
    "auto_allow": [
      "read_file",
      "list_directory",
      "memory_probe",
      "kline_retrieve",
      "search_web_read_only"
    ],
    "requires_approval": [
      "write_file",
      "send_message",
      "create_calendar_event",
      "run_shell_command",
      "call_external_api"
    ],
    "deny": [
      "delete_file",
      "modify_system_config",
      "install_package"
    ]
  },
  "default_unclassified": "requires_approval",
  "approval_timeout_seconds": 120,
  "fail_closed": true
}
```

**Key principles (from nanoclaw):**
- Unclassified tools default to `requires_approval`, not `auto_allow`
- Policy server unreachable → **fail closed** (deny, not allow)
- Timeout → deny
- Config lives outside containers — agents cannot modify their own tool permissions

### 4.1 Approval flow

When a tool needs approval:

```
1. PreToolUse hook sends to approval server: { tool, params, agent_id, context }
2. Approval server stores request, generates approval_id
3. Introspection app shows pending approval to human
4. Human sees: which agent, which tool, what parameters, why (from agent's reasoning signal)
5. Human approves or denies with optional reason
6. Approval server stores verdict
7. Hook polls until verdict or timeout
8. Timeout → deny, log as "approval timed out"
```

The introspection app is where approvals happen. The human sees the full context: which K-lines the agent retrieved, what reasoning led to the tool call, what the tool would do. This is the B-Brain in action — observing the A-Brain before allowing it to act.

---

## 5. Observability: What the Introspection App Shows

The introspection app (see ARCHITECTURE.md §3.7) is the central interface for everything in this document. With these additions, it now has two modes of its own:

### 5.1 Watch mode (passive)
Real-time event stream. Shows:
- Agent activations (who's reasoning right now)
- Polyneme signals flowing between agents
- K-lines retrieved (what the system remembered)
- Censors fired (what was blocked)
- Tool intents intercepted in OBSERVE mode
- Difference-engine state (if goals are active)

### 5.2 Ask mode (interactive)
Chat interface that routes queries to the QueryAgent. Shows structured memory probe results alongside a natural language response from the society. This is how you test whether the memory system works: ask the same question before and after accumulating K-lines and compare the responses.

### 5.3 Pending approvals (ACT mode only)
Queue of tool calls awaiting human approval. Each shows the full context: agent, tool, params, relevant K-lines, causal event chain. One-click approve/deny.

---

## 6. Security Boundaries (Adapted from nanoclaw)

The society runs agents in isolated containers. Key boundaries:

| Boundary | Mechanism | What it prevents |
|---|---|---|
| Mode gate | PreToolUse hook in every container | World-affecting actions in OBSERVE mode |
| Tool tier enforcement | External policy config + approval server | Unapproved actions in ACT mode |
| Credential isolation | Host-side credential proxy (nanoclaw pattern) | Real API keys never in containers |
| Filesystem isolation | Read-only mounts except explicit write paths | Agents modifying their own code or config |
| Policy config location | `~/.som/policy/` outside project root | Agents modifying their own permissions |
| Fail closed | Unreachable approval server → deny | Accidental execution when oversight is unavailable |
| IPC authorization | Main vs non-main group distinction | Agents hijacking each other's execution contexts |

### Container mount strategy

```
Agent container sees:
  /workspace/society/       ← project code, READ-ONLY
  /workspace/data/          ← K-line store, event log, READ-ONLY for most agents
  /workspace/data/klines/   ← K-line store, READ-WRITE for MemoryManager only
  /workspace/ipc/           ← intent queue (IPC bus), READ-WRITE
  /dev/null                 ← shadows .env, preventing credential leakage
```

Only `MemoryManager` gets write access to the K-line store. Other agents request memory writes by emitting a `memory.capture` polyneme — `MemoryManager` processes the queue and writes.

---

## 7. How to Test Memory Learning

The query interface makes it possible to run controlled learning experiments:

### Experiment template

```
1. Start with empty K-line store
2. Ask: "What do you know about [topic]?" → expect from_cold_start: true
3. Run a task (in OBSERVE mode — agents reason but don't act)
4. Task succeeds → K-line created
5. Ask: "What do you know about [topic]?" → expect at least 1 K-line above threshold
6. Run a similar-but-different task
7. Ask again → compare which K-lines surface, what confidence, what agents suggested
8. Repeat until K-line retrieval is meaningfully shaping agent behavior
```

This is the minimum viable experiment. You don't need ACT mode to run it. Every task can be a simulated reasoning exercise in OBSERVE mode, and the memory system will still accumulate.

The introspection app's Ask mode makes this experiment interactive: type a question, see what the society remembers, run another task, ask again.

---

## 8. What This Doesn't Change

- **The architecture** — layers, signals, K-line semantics, frames, difference-engines are unchanged
- **The agent model** — agents are still LLM-backed, still communicate via polyneme bus
- **The K-line design** — everything in `KLINE_MEMORY.md` still applies
- **The research questions** — the same open questions in FEASIBILITY.md §7 are still what we're trying to answer

What changes is the **approach to getting there**: observe before acting, validate memory before trusting it, gate every action. The society can become genuinely useful — and genuinely safe — in OBSERVE mode alone. ACT mode is an upgrade, not the default.
