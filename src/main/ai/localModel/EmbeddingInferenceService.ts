import { Injectable, Phase, ServicePhase } from '@main/core/lifecycle'

import { InferenceServiceBase } from './runtime/InferenceServiceBase'
import type { EmbeddingModelDir } from './runtime/protocol/embedding'

/** Local text-embedding inference (transformers.js / Qwen3-Embedding) in its own
 * worker; see {@link InferenceServiceBase} for the shared worker lifecycle. */
@Injectable('EmbeddingInferenceService')
@ServicePhase(Phase.WhenReady)
export class EmbeddingInferenceService extends InferenceServiceBase {
  constructor() {
    super('embedding')
  }

  /** Embed texts off the main thread, loading the model from `modelDir` if it is not cached in memory. */
  async embed(texts: string[], modelDir: EmbeddingModelDir, dtype: string, signal?: AbortSignal): Promise<number[][]> {
    const { embeddings } = await this.send({ type: 'embedding.embed', modelDir, dtype, texts }, { signal })
    return embeddings
  }

  /** Count tokens via the pipeline's own tokenizer, off the main thread — the main
   * process must never import `@huggingface/transformers` itself (see
   * localEmbeddingTokenLimit.ts, which transitively requires onnxruntime-node). */
  async countTokens(
    texts: string[],
    modelDir: EmbeddingModelDir,
    dtype: string,
    signal?: AbortSignal
  ): Promise<number[]> {
    const { tokenCounts } = await this.send({ type: 'embedding.countTokens', modelDir, dtype, texts }, { signal })
    return tokenCounts
  }
}
