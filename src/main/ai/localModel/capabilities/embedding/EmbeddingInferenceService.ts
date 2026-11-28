import { Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type { LocalModelBundleId } from '@shared/data/presets/localModel'

import { bundleDtype, getModelBundle } from '../../catalog/catalog'
import { localModelStorageService } from '../../installation/LocalModelStorageService'
import { type EmbeddingInferenceContract, embeddingInferenceProcess } from '../../runtime/inferenceProcess'
import { InferenceServiceBase } from '../../runtime/InferenceServiceBase'

/** Local text-embedding inference (transformers.js) in its own utility process. */
@Injectable('EmbeddingInferenceService')
@ServicePhase(Phase.WhenReady)
export class EmbeddingInferenceService extends InferenceServiceBase<EmbeddingInferenceContract> {
  constructor() {
    super(embeddingInferenceProcess, 'embedding')
  }

  /** Embed texts off the main thread, loading the selected bundle when it is not cached in memory. */
  async embed(bundleId: LocalModelBundleId, texts: string[], signal?: AbortSignal): Promise<number[][]> {
    return this.run(bundleId, 'embed', () => ({ ...this.resolveModel(bundleId), texts }), { signal })
  }

  /** Count tokens via the selected bundle's own tokenizer, off the main thread — the main
   * process must never import `@huggingface/transformers` itself (see
   * localEmbeddingTokenLimit.ts, which transitively requires onnxruntime-node). */
  async countTokens(bundleId: LocalModelBundleId, texts: string[], signal?: AbortSignal): Promise<number[]> {
    return this.run(bundleId, 'countTokens', () => ({ ...this.resolveModel(bundleId), texts }), { signal })
  }

  private resolveModel(bundleId: LocalModelBundleId): { modelDir: string; dtype: string } {
    const bundle = getModelBundle(bundleId)
    if (bundle.capability !== 'embedding') {
      throw new Error(`bundle "${bundleId}" is not an embedding model`)
    }
    const modelDir = localModelStorageService.resolveInstalledDir(bundle)
    const artifactsReady = bundle.requires.every((id) => localModelStorageService.isArtifactReady(id))
    if (!modelDir || !artifactsReady) throw new Error('the local embedding model is not fully downloaded')
    return { modelDir, dtype: bundleDtype(bundle) }
  }
}
