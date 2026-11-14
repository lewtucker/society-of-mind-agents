// ─── Conversation signal payload types ───────────────────────────────────────

export interface ConversationInputPayload {
  turn_id: string;
  query:   string;
}

export interface TopicIdentifiedPayload {
  turn_id:  string;
  query:    string;
  topic:    string;
  keywords: string[];
}

export interface ContextRetrievedPayload {
  turn_id:  string;
  query:    string;
  topic:    string;
  keywords: string[];
  /** Scored K-lines from retrieval — empty on the first turn about a topic. */
  klines: Array<{ id: string; score: number; description: string }>;
}

export interface ConversationResponsePayload {
  turn_id:             string;
  query:               string;
  topic:               string;
  response:            string;
  retrieved_kline_ids: string[];
  /** Embedded as the K-line situation description. */
  description:         string;
}
