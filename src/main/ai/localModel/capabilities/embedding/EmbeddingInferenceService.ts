import { Injectable, Phase, ServicePhase } from '@main/core/lifecycle'

import { bundleDtype, bundleForCapability } from '../../catalog/catalog'
import { localModelStorageService } from '../../installation/LocalModelStorageService'
import { type EmbeddingInferenceContract, embeddingInferenceProcess } from '../../runtime/inferenceProcess'
import { InferenceServiceBase } from '../../runtime/InferenceServiceBase'

/** Local text-embedding inference (transformers.js / Qwen3-Embedding) in its own utility process. */
@Injectable('EmbeddingInferenceService')
@ServicePhase(Phase.WhenReady)
export class EmbeddingInferenceService extends InferenceServiceBase<EmbeddingInferenceContract> {
  constructor() {
    super(embeddingInferenceProcess, 'embedding')
  }

  /** Embed texts off the main thread, loading the installed model when it is not cached in memory. */
  async embed(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    const { modelDir, dtype } = this.resolveModel()
    return this.run('embed', { modelDir, dtype, texts }, { signal })
  }

  /** Count tokens via the pipeline's own tokenizer, off the main thread — the main
   * process must never import `@huggingface/transformers` itself (see
   * localEmbeddingTokenLimit.ts, which transitively requires onnxruntime-node). */
  async countTokens(texts: string[], signal?: AbortSignal): Promise<number[]> {
    const { modelDir, dtype } = this.resolveModel()
    return this.run('countTokens', { modelDir, dtype, texts }, { signal })
  }

  private resolveModel(): { modelDir: string; dtype: string } {
    const bundle = bundleForCapability('embedding')
    const modelDir = localModelStorageService.resolveInstalledDir(bundle)
    const artifactsReady = bundle.requires.every((id) => localModelStorageService.isArtifactReady(id))
    if (!modelDir || !artifactsReady) throw new Error('the local embedding model is not fully downloaded')
    return { modelDir, dtype: bundleDtype(bundle) }
  }
}
