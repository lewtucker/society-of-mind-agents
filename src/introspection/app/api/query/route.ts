import { EventLogReader, DEFAULT_DB_PATH } from "../../lib/EventLogReader";
import { KLineReader, DEFAULT_KLINE_DB_PATH } from "../../lib/KLineReader";

export const dynamic = "force-dynamic";

// ─── POST /api/query ──────────────────────────────────────────────────────────

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const q = body as { type?: string; eventId?: string; situation?: string; action?: string; agentId?: string };
  if (!q.type) {
    return Response.json({ error: "Missing query type" }, { status: 400 });
  }

  // MEMORY_PROBE and CENSOR_CHECK use the K-line store
  if (q.type === "MEMORY_PROBE" || q.type === "CENSOR_CHECK") {
    return handleMemoryQuery(q);
  }

  // Other queries use the event log
  const reader = EventLogReader.tryOpen(DEFAULT_DB_PATH);

  if (!reader) {
    if (q.type === "ACTIVATION_QUERY") {
      return Response.json({ type: "ACTIVATION_QUERY", agents: [], stub: true });
    }
    if (q.type === "CAUSAL_TRACE") {
      return Response.json({ type: "CAUSAL_TRACE", chain: [], eventId: q.eventId ?? "", complete: false, stub: true });
    }
    return Response.json({ type: q.type, stub: true, note: "No event log found at ~/.som/events.db" });
  }

  try {
    switch (q.type) {
      case "ACTIVATION_QUERY": {
        const agents = reader.activationStates();
        return Response.json({ type: "ACTIVATION_QUERY", agents });
      }

      case "CAUSAL_TRACE": {
        if (!q.eventId) {
          return Response.json({ error: "CAUSAL_TRACE requires eventId" }, { status: 400 });
        }
        const chain: ReturnType<typeof reader.getById>[] = [];
        let currentId: string | null = q.eventId;
        let complete = false;
        for (let i = 0; i < 100; i++) {
          if (!currentId) { complete = true; break; }
          const event = reader.getById(currentId);
          if (!event) break;
          chain.unshift(event);
          currentId = event.causedBy;
        }
        return Response.json({ type: "CAUSAL_TRACE", chain, eventId: q.eventId, complete });
      }

      case "REASONING_PROBE":
        return Response.json({ type: "REASONING_PROBE", wouldEmit: [], stub: true, note: "Requires live agent — use QueryEngine directly" });

      default:
        return Response.json({ error: `Unknown query type: ${q.type}` }, { status: 400 });
    }
  } finally {
    reader.close();
  }
}

// ─── Memory queries ───────────────────────────────────────────────────────────

function handleMemoryQuery(q: { type?: string; situation?: string; action?: string; agentId?: string }) {
  const klineReader = KLineReader.tryOpen(DEFAULT_KLINE_DB_PATH);

  if (!klineReader) {
    return Response.json({
      type: q.type,
      klines: [],
      stub: true,
      note: "No K-line store found at ~/.som/klines.db — start the society first.",
    });
  }

  try {
    if (q.type === "MEMORY_PROBE") {
      const situation = q.situation?.trim() ?? "";
      if (!situation) {
        return Response.json({ error: "MEMORY_PROBE requires situation text" }, { status: 400 });
      }
      const results = klineReader.retrieve(situation, { topK: 5 });
      return Response.json({ type: "MEMORY_PROBE", situation, klines: results, stub: false });
    }

    if (q.type === "CENSOR_CHECK") {
      const situation = q.situation?.trim() ?? "";
      const action    = q.action?.trim() ?? "";
      if (!situation || !action) {
        return Response.json({ error: "CENSOR_CHECK requires situation and action" }, { status: 400 });
      }
      const all = klineReader.retrieve(situation, { topK: 10, typeFilter: "censor" });
      const proposed = action.toLowerCase();
      const matching = all.filter(({ kline }) => {
        const blocked = kline.guard?.blocked_action.toLowerCase() ?? "";
        return blocked && (blocked === proposed || proposed.includes(blocked) || blocked.includes(proposed));
      });
      return Response.json({
        type:            "CENSOR_CHECK",
        agentId:         q.agentId ?? "",
        action,
        situation,
        wouldFire:       matching.length > 0,
        matchingCensors: matching,
        stub:            false,
      });
    }

    return Response.json({ error: `Unknown query type: ${q.type}` }, { status: 400 });
  } finally {
    klineReader.close();
  }
}
