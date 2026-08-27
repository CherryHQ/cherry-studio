/**
 * Text-embedding requests (transformers.js / Qwen3-Embedding) and what each answers with.
 * Paired with `../workerSource/embeddingWorkerModule.ts`, which implements them.
 */

/**
 * Absolute path to the installed embedding model — the directory holding `config.json`.
 * The registry resolves it from its own on-disk scan, exactly as it does for OCR.
 *
 * Passing a path rather than a repo id is what keeps inference offline: transformers.js
 * classifies it via `isValidHfModelId`, and every remote branch in its resolver is gated
 * on that being true, so file discovery can only read the local filesystem.
 */
export type EmbeddingModelDir = string

/** Embed texts; loads the pipeline from local files if it is not cached in memory. */
export interface EmbeddingEmbedMessage {
  type: 'embedding.embed'
  id: string
  modelDir: EmbeddingModelDir
  dtype: string
  texts: string[]
}

/** Count tokens via the pipeline's own tokenizer; loads the pipeline from local files if
 * it is not cached in memory. Keeps token counting off the main process, which must
 * never import `@huggingface/transformers` itself (see localEmbeddingTokenLimit.ts). */
export interface EmbeddingCountTokensMessage {
  type: 'embedding.countTokens'
  id: string
  modelDir: EmbeddingModelDir
  dtype: string
  texts: string[]
}

export interface EmbeddingPayloads {
  'embedding.embed': { embeddings: number[][] }
  'embedding.countTokens': { tokenCounts: number[] }
}
