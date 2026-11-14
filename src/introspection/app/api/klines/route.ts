import { KLineReader, DEFAULT_KLINE_DB_PATH } from "../../lib/KLineReader";
import { EventLogReader, DEFAULT_DB_PATH } from "../../lib/EventLogReader";

export const dynamic = "force-dynamic";

/**
 * GET /api/klines
 *
 * Returns K-lines + current agent activation states for the Memory Feedback Graph.
 * Both sources are opened read-only (B-Brain principle).
 *
 * Response shape:
 *   { klines: KLineData[], agentStates: { id, state }[], hasKLines: boolean }
 */
export async function GET() {
  const klineReader = KLineReader.tryOpen(DEFAULT_KLINE_DB_PATH);
  const eventReader = EventLogReader.tryOpen(DEFAULT_DB_PATH);

  try {
    const klines      = klineReader ? klineReader.list(100) : [];
    const agentStates = eventReader ? eventReader.activationStates() : [];

    return Response.json({
      klines,
      agentStates,
      hasKLines: klineReader !== null,
    });
  } finally {
    klineReader?.close();
    eventReader?.close();
  }
}
