/**
 * Text-embedding requests (transformers.js / Qwen3-Embedding) and what each answers with.
 * Implemented by the embedding utility-process handler.
 */

/**
 * Absolute path to the installed embedding model — the directory holding `config.json`.
 * The storage service resolves it from its on-disk scan, exactly as it does for OCR.
 *
 * Passing a path rather than a repo id is what keeps inference offline: transformers.js
 * classifies it via `isValidHfModelId`, and every remote branch in its resolver is gated
 * on that being true, so file discovery can only read the local filesystem.
 */
export type EmbeddingModelDir = string

/** Embed texts; loads the pipeline from local files if it is not cached in memory. */
export interface EmbeddingEmbedPayload {
  modelDir: EmbeddingModelDir
  dtype: string
  texts: string[]
}

/** Count tokens via the pipeline's own tokenizer; loads the pipeline from local files if
 * it is not cached in memory. Keeps token counting off the main process, which must
 * never import `@huggingface/transformers` itself (see localEmbeddingTokenLimit.ts). */
export interface EmbeddingCountTokensPayload {
  modelDir: EmbeddingModelDir
  dtype: string
  texts: string[]
}

export type EmbeddingRequestPayloads = {
  embed: EmbeddingEmbedPayload
  countTokens: EmbeddingCountTokensPayload
}

export type EmbeddingResultPayloads = {
  embed: { embeddings: number[][] }
  countTokens: { tokenCounts: number[] }
}

export const EMBEDDING_RESULT_KEYS = {
  embed: ['embeddings'],
  countTokens: ['tokenCounts']
} as const
