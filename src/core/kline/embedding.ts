import { createHash } from "node:crypto";

// ─── Provider interface ───────────────────────────────────────────────────────

export interface EmbeddingProvider {
  readonly modelName: string;
  embed(text: string): Promise<number[]>;
  /** Dimension count this provider produces */
  readonly dims: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** SHA-256 hex of text — used as the embedding cache key */
export function hashText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Tokenize: lowercase, split on non-alphanumeric, drop short tokens */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
}

/** Simple DJB2-style hash — maps a token to an index in [0, dims) */
function tokenToDimension(token: string, dims: number): number {
  let h = 5381;
  for (let i = 0; i < token.length; i++) {
    h = ((h << 5) + h + token.charCodeAt(i)) & 0x7fffffff;
  }
  return h % dims;
}

/** L2-normalize a vector in place. Returns the same array. */
function l2Normalize(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  if (norm === 0) return vec;
  for (let i = 0; i < vec.length; i++) vec[i] /= norm;
  return vec;
}

// ─── BagOfWordsEmbedder ───────────────────────────────────────────────────────

/**
 * A deterministic, zero-dependency embedding provider for development and tests.
 *
 * Produces 64-dimensional bag-of-words vectors via hash projection + L2 norm.
 * Two texts sharing vocabulary will produce similar vectors (high cosine similarity).
 * Two texts with no overlapping tokens will be orthogonal (cosine ≈ 0).
 *
 * Not for production — swap in OpenAIEmbedder (below) once you have an API key.
 * The retrieval pipeline is provider-agnostic; changing the embedder requires
 * re-embedding all stored K-lines (embedding_model mismatch detection in Phase 2+).
 */
export class BagOfWordsEmbedder implements EmbeddingProvider {
  readonly modelName = "bag-of-words-64";
  readonly dims = 64;

  async embed(text: string): Promise<number[]> {
    const tokens = tokenize(text);
    const vec = new Array<number>(this.dims).fill(0);
    for (const token of tokens) {
      vec[tokenToDimension(token, this.dims)] += 1;
    }
    return l2Normalize(vec);
  }
}

// ─── OpenAIEmbedder (production) ─────────────────────────────────────────────

/**
 * Production embedding provider using OpenAI text-embedding-3-small (1536d).
 *
 * Usage:
 *   import OpenAI from "openai";
 *   const embedder = new OpenAIEmbedder(new OpenAI());
 *
 * Requires: npm install openai
 * Requires: OPENAI_API_KEY environment variable
 *
 * Not instantiated unless explicitly constructed — no hard openai dependency.
 */
export class OpenAIEmbedder implements EmbeddingProvider {
  readonly modelName = "text-embedding-3-small";
  readonly dims = 1536;

  // openai client typed as `any` to avoid hard import dependency
  constructor(private readonly client: { embeddings: { create(opts: unknown): Promise<{ data: Array<{ embedding: number[] }> }> } }) {}

  async embed(text: string): Promise<number[]> {
    const res = await this.client.embeddings.create({
      model: "text-embedding-3-small",
      input: text,
    });
    return res.data[0].embedding;
  }
}
