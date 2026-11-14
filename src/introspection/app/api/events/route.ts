import { AGENT_IDS } from "../../lib/scenario";
import { getFrame, getScenarioLength } from "../../lib/scenario";
import { getFrame as getDemoFrame, waitForStep } from "../../lib/demoState";
import { EventLogReader, DEFAULT_DB_PATH } from "../../lib/EventLogReader";
import type { AgentStatus, Snapshot, SocietyEvent } from "../../types";
import type { LiveEvent } from "../../lib/EventLogReader";

export const dynamic = "force-dynamic";

// ─── Constants ────────────────────────────────────────────────────────────────

const B_BRAIN_IDS = new Set([
  "confusion-detector",
  "conflict-monitor",
  "progress-tracker",
]);

// An agent is considered "active" if it emitted a signal within this window
const ACTIVE_WINDOW_MS = 2000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function liveEventToSocietyEvent(e: LiveEvent): SocietyEvent {
  return {
    id:        e.id,
    timestamp: e.timestamp,
    source:    e.source,
    signal:    e.signal,
    type:      e.type,
    summary:   e.summary,
    causedBy:  e.causedBy,
  };
}

/**
 * Derive agent statuses from recent activity.
 * An agent is "active" if it fired a signal within ACTIVE_WINDOW_MS.
 * B-Brain agents are always "watching".
 * Everything else is "dormant".
 */
function deriveStatuses(
  agentIds: string[],
  lastActive: Map<string, number>,
  activationCounts: Map<string, number>,
  now: number,
): Record<string, AgentStatus> {
  const statuses: Record<string, AgentStatus> = {};
  for (const id of agentIds) {
    const last = lastActive.get(id) ?? 0;
    const state =
      B_BRAIN_IDS.has(id) ? "watching" :
      now - last < ACTIVE_WINDOW_MS ? "active" :
      "dormant";
    statuses[id] = {
      agentId:         id,
      state,
      lastSignal:      null,
      activationCount: activationCounts.get(id) ?? 0,
    };
  }
  return statuses;
}

// ─── Real-log streaming ────────────────────────────────────────────────────────

function streamRealLog(reader: EventLogReader): Response {
  const encoder = new TextEncoder();
  const lastActive = new Map<string, number>();
  const activationCounts = new Map<string, number>();

  // Seed from recent history so the UI has context immediately on connect
  const history = reader.recent(200);
  const now = Date.now();
  for (const e of history) {
    lastActive.set(e.source, e.timestamp);
    activationCounts.set(e.source, (activationCounts.get(e.source) ?? 0) + 1);
  }

  // Build the full agent id list: predefined + any extra seen in the log
  const allAgentIds = [...AGENT_IDS];
  for (const e of history) {
    if (!allAgentIds.includes(e.source)) allAgentIds.push(e.source);
  }

  let cursor = history.at(-1)?.id ?? "";
  let tick = 0;
  let timeoutId: ReturnType<typeof setTimeout>;

  const stream = new ReadableStream({
    start(controller) {
      // Replay history so the event feed populates on connect
      const statuses = deriveStatuses(allAgentIds, lastActive, activationCounts, now);
      if (history.length === 0) {
        // Empty log — send one snapshot so the UI shows "connected"
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(
          { mode: "OBSERVE", statuses, event: null, tick: tick++, paused: false }
        )}\n\n`));
      } else {
        for (const e of history) {
          const snapshot: Snapshot = {
            mode:     "OBSERVE",
            statuses,
            event:    liveEventToSocietyEvent(e),
            tick:     tick++,
            paused:   false,
          };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(snapshot)}\n\n`));
        }
      }

      function poll() {
        const newEvents = reader.poll(cursor);
        const pollTime = Date.now();

        for (const e of newEvents) {
          cursor = e.id;
          lastActive.set(e.source, e.timestamp);
          activationCounts.set(e.source, (activationCounts.get(e.source) ?? 0) + 1);
          if (!allAgentIds.includes(e.source)) allAgentIds.push(e.source);

          // Emit a snapshot for each new event so the UI updates immediately
          const snapshot: Snapshot = {
            mode:     "OBSERVE",
            statuses: deriveStatuses(allAgentIds, lastActive, activationCounts, pollTime),
            event:    liveEventToSocietyEvent(e),
            tick:     tick++,
            paused:   false,
          };
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(snapshot)}\n\n`));
          } catch {
            return; // client disconnected
          }
        }

        // If no new events, still push a heartbeat snapshot every 2s so agent
        // states transition from "active" to "dormant" as time passes
        if (newEvents.length === 0) {
          const snapshot: Snapshot = {
            mode:     "OBSERVE",
            statuses: deriveStatuses(allAgentIds, lastActive, activationCounts, pollTime),
            event:    null,
            tick:     tick++,
            paused:   false,
          };
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(snapshot)}\n\n`));
          } catch {
            return;
          }
        }

        timeoutId = setTimeout(poll, newEvents.length > 0 ? 100 : 2000);
      }

      poll();
    },
    cancel() {
      clearTimeout(timeoutId);
      reader.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection:      "keep-alive",
    },
  });
}

// ─── Mock scenario streaming (fallback when no real log exists) ───────────────

function streamMockScenario(): Response {
  const encoder = new TextEncoder();
  const total = getScenarioLength();

  const stream = new ReadableStream({
    start(controller) {
      (async () => {
        const send = () => {
          const frame = getDemoFrame();
          const { snapshot } = getFrame(frame);
          const enriched = { ...snapshot, isDemo: true, demoFrame: frame, demoTotal: total };
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(enriched)}\n\n`));
            return true;
          } catch {
            return false;
          }
        };

        // Send the current frame immediately on connect
        if (!send()) return;

        // Then wait for each manual step
        while (getDemoFrame() < total) {
          await waitForStep();
          if (!send()) break;
        }
      })();
    },
    cancel() {
      // IIFE exits on next enqueue failure when client disconnects
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection:      "keep-alive",
    },
  });
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET() {
  const reader = EventLogReader.tryOpen(DEFAULT_DB_PATH);
  return reader ? streamRealLog(reader) : streamMockScenario();
}
