import { application } from '@application'
import { Injectable, Phase, ServicePhase } from '@main/core/lifecycle'

import type { EmbeddingModelDir, InferenceModelSource } from './inferenceProtocol'
import { type InferenceProgress, InferenceServiceBase } from './InferenceServiceBase'

/** Local text-embedding inference (transformers.js / Qwen3-Embedding) in its own
 * worker; see {@link InferenceServiceBase} for the shared worker lifecycle. */
@Injectable('EmbeddingInferenceService')
@ServicePhase(Phase.WhenReady)
export class EmbeddingInferenceService extends InferenceServiceBase {
  constructor() {
    super('embedding')
  }

  /** The embedding worker caches transformers.js weights under this directory. */
  protected override workerCacheDir(): string {
    return application.getPath('feature.embedding.models')
  }

  /** Embed texts off the main thread, loading the model from `modelDir` if it is not cached in memory. */
  async embed(texts: string[], modelDir: EmbeddingModelDir, dtype: string, signal?: AbortSignal): Promise<number[][]> {
    const result = await this.send({ type: 'embedding.embed', modelDir, dtype, texts }, { signal })
    // A missing field is a protocol violation — silently embedding nothing would
    // poison every downstream consumer (empty vectors indexed as real ones).
    if (!result.embeddings) throw new Error('inference worker returned an embed result without embeddings')
    return result.embeddings
  }

  /** Download/load the embedding model, reporting progress (used by the model card). */
  async loadEmbedding(
    source: InferenceModelSource,
    modelRepo: string,
    dtype: string,
    onProgress?: (p: InferenceProgress) => void,
    signal?: AbortSignal
  ): Promise<void> {
    await this.send({ type: 'embedding.load', modelRepo, dtype, source }, { onProgress, signal })
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
    const result = await this.send({ type: 'embedding.countTokens', modelDir, dtype, texts }, { signal })
    // Same protocol guard as embed: `[count] = []` would make every chunk-size
    // comparison silently false instead of failing the indexing request.
    if (!result.tokenCounts) throw new Error('inference worker returned a countTokens result without token counts')
    return result.tokenCounts
  }
}
