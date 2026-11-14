import { Agent }                    from "../agent/Agent.ts";
import type { AgentContext, AgentOptions, AgentResponse } from "../agent/types.ts";
import type { EventLog }            from "../event-log/EventLog.ts";
import type { KLineStore }          from "../kline/KLineStore.ts";
import type { EmbeddingProvider }   from "../kline/embeddings.ts";
import type { KLineRetrievalEngine } from "../kline/retrieval.ts";
import { capturePositiveKLine }     from "../kline/capture.ts";
import type {
  ConversationInputPayload,
  TopicIdentifiedPayload,
  ContextRetrievedPayload,
  ConversationResponsePayload,
} from "./types.ts";

// ─── TopicAgent ───────────────────────────────────────────────────────────────

/**
 * Identifies the topic and keywords from a raw conversation query.
 *
 * Deterministic implementation: lowercases and tokenises the query.
 * The first non-stopword token becomes the topic; all tokens become keywords.
 * Replace with an LLM-backed handler for richer extraction in production.
 */
export function createTopicAgent(): Agent {
  return new Agent({
    id:           "topic-agent",
    name:         "Topic Agent",
    systemPrompt: "Identifies the topic and keywords in a conversation query.",
    signals:      ["conversation.input"],
    capability:   "deterministic",
    handler: (ctx: AgentContext): AgentResponse => {
      const { turn_id, query } = ctx.trigger.payload as ConversationInputPayload;

      const stopwords = new Set(["the", "a", "an", "tell", "me", "about", "what", "is", "are", "how", "i", "you"]);
      const tokens = query.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean);
      const keywords = tokens.filter((t) => !stopwords.has(t));
      const topic = keywords[0] ?? tokens[0] ?? "unknown";

      return {
        emit: [{
          signal:  "topic.identified",
          type:    "polyneme" as const,
          payload: { turn_id, query, topic, keywords } satisfies TopicIdentifiedPayload,
        }],
      };
    },
  } satisfies AgentOptions);
}

// ─── RetrievalAgent ───────────────────────────────────────────────────────────

/**
 * Retrieves relevant K-lines for the identified topic.
 *
 * Uses the KLineRetrievalEngine hybrid pipeline (vector + BM25 + temporal decay).
 * On the first conversation about a topic the result will be empty — that is expected.
 */
export function createRetrievalAgent(retrieval: KLineRetrievalEngine): Agent {
  return new Agent({
    id:           "retrieval-agent",
    name:         "Retrieval Agent",
    systemPrompt: "Retrieves relevant K-line memories for the current conversation topic.",
    signals:      ["topic.identified"],
    capability:   "deterministic",
    handler: (ctx: AgentContext): AgentResponse => {
      const p = ctx.trigger.payload as TopicIdentifiedPayload;
      const queryText = [p.topic, ...p.keywords].join(" ");

      retrieval.retrieve(queryText, { topK: 5, typeFilter: "positive" })
        .then((scored) => {
          const klines = scored.map((s) => ({
            id:          s.kline.id,
            score:       s.score,
            description: s.kline.situation.description,
          }));

          const payload: ContextRetrievedPayload = {
            turn_id:  p.turn_id,
            query:    p.query,
            topic:    p.topic,
            keywords: p.keywords,
            klines,
          };

          ctx.bus.emit({
            source:   "retrieval-agent",
            signal:   "context.retrieved",
            type:     "polyneme",
            payload,
            context:  ctx.trigger.context,
            causedBy: ctx.trigger.id,
          });
        })
        .catch(() => {
          // Never crash the bus — emit empty context on error
          ctx.bus.emit({
            source:   "retrieval-agent",
            signal:   "context.retrieved",
            type:     "polyneme",
            payload: {
              turn_id:  p.turn_id,
              query:    p.query,
              topic:    p.topic,
              keywords: p.keywords,
              klines:   [],
            } satisfies ContextRetrievedPayload,
            context:  ctx.trigger.context,
            causedBy: ctx.trigger.id,
          });
        });

      return { emit: [] };
    },
  } satisfies AgentOptions);
}

// ─── ResponseAgent ────────────────────────────────────────────────────────────

/**
 * Generates a conversation response given the retrieved context.
 *
 * Deterministic implementation produces a simple template response that
 * mentions how many memories were found — sufficient to validate the memory
 * pipeline without LLM calls.  Replace with an LLM-backed handler for
 * natural-language responses in production.
 *
 * The payload includes `description` so capturePositiveKLine() embeds
 * predictable vocabulary for future retrieval (same pattern as FindAgent).
 */
export function createResponseAgent(): Agent {
  return new Agent({
    id:           "response-agent",
    name:         "Response Agent",
    systemPrompt: "Generates a response to the user using retrieved memories as context.",
    signals:      ["context.retrieved"],
    capability:   "deterministic",
    handler: (ctx: AgentContext): AgentResponse => {
      const p = ctx.trigger.payload as ContextRetrievedPayload;

      const memoryNote = p.klines.length > 0
        ? `(drawing on ${p.klines.length} memory${p.klines.length > 1 ? "s" : ""})`
        : "(no prior memories)";

      const response = `Responding to: "${p.query}" ${memoryNote}`;

      // Build description with topic vocabulary for K-line embedding
      const description = `conversation ${p.topic} ${p.keywords.join(" ")} query response`;

      const payload: ConversationResponsePayload = {
        turn_id:             p.turn_id,
        query:               p.query,
        topic:               p.topic,
        response,
        retrieved_kline_ids: p.klines.map((k) => k.id),
        description,
      };

      return {
        emit: [{
          signal:  "conversation.response",
          type:    "polyneme" as const,
          payload,
        }],
      };
    },
  } satisfies AgentOptions);
}

// ─── ConversationMemoryAgent ──────────────────────────────────────────────────

/**
 * Captures a positive K-line after each conversation response.
 *
 * Analogous to createMemoryCaptureAgent() but scoped to conversation.response
 * signals and uses a distinct agent ID so both can coexist in the same agency.
 */
export function createConversationMemoryAgent(
  log:      EventLog,
  store:    KLineStore,
  embedder: EmbeddingProvider,
): Agent {
  return new Agent({
    id:           "conversation-memory-agent",
    name:         "Conversation Memory Agent",
    systemPrompt: "Captures K-line memories after each conversation turn.",
    signals:      ["conversation.response"],
    capability:   "deterministic",
    handler: (ctx: AgentContext): AgentResponse => {
      capturePositiveKLine(ctx.trigger, log, store, embedder)
        .then((result) => {
          ctx.bus.emit({
            source:   "conversation-memory-agent",
            signal:   "kline.captured",
            type:     "polyneme",
            payload: {
              klineId:              result.klineId,
              situationDescription: result.situation.description,
              activationCount:      result.activationCount,
            },
            context:  { pronomes: {}, frame_id: null, kline_ids: [result.klineId], micronemes: [] },
            causedBy: ctx.trigger.id,
          });
        })
        .catch((err: unknown) => {
          ctx.bus.emit({
            source:   "conversation-memory-agent",
            signal:   "kline.capture.error",
            type:     "polyneme",
            payload:  { error: String(err) },
            context:  { pronomes: {}, frame_id: null, kline_ids: [], micronemes: [] },
            causedBy: ctx.trigger.id,
          });
        });

      return { emit: [] };
    },
  } satisfies AgentOptions);
}
