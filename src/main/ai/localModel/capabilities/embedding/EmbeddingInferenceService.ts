import { Injectable, Phase, ServicePhase } from '@main/core/lifecycle'

import { bundleDtype, bundleForCapability } from '../../catalog/catalog'
import { localModelStorageService } from '../../installation/LocalModelStorageService'
import { InferenceServiceBase } from '../../runtime/InferenceServiceBase'
import { onnxRuntimeWorkerSource } from '../../runtime/worker/onnxRuntime'
import { EMBEDDING_RESULT_KEYS, type EmbeddingRequestPayloads, type EmbeddingResultPayloads } from './protocol'
import { embeddingWorkerSource } from './worker'

/** Local text-embedding inference (transformers.js / Qwen3-Embedding) in its own
 * worker; see {@link InferenceServiceBase} for the shared worker lifecycle. */
@Injectable('EmbeddingInferenceService')
@ServicePhase(Phase.WhenReady)
export class EmbeddingInferenceService extends InferenceServiceBase<
  'embedding',
  EmbeddingRequestPayloads,
  EmbeddingResultPayloads
> {
  constructor() {
    const bundle = bundleForCapability('embedding')
    super({
      capability: 'embedding',
      sharedArtifacts: bundle.requires,
      runtimeModuleSource: onnxRuntimeWorkerSource,
      workerModuleSource: embeddingWorkerSource,
      resultKeys: EMBEDDING_RESULT_KEYS
    })
  }

  /** Embed texts off the main thread, loading the installed model when it is not cached in memory. */
  async embed(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    const { modelDir, dtype } = this.resolveModel()
    const { embeddings } = await this.send('embed', { modelDir, dtype, texts }, { signal })
    return embeddings
  }

  /** Count tokens via the pipeline's own tokenizer, off the main thread — the main
   * process must never import `@huggingface/transformers` itself (see
   * localEmbeddingTokenLimit.ts, which transitively requires onnxruntime-node). */
  async countTokens(texts: string[], signal?: AbortSignal): Promise<number[]> {
    const { modelDir, dtype } = this.resolveModel()
    const { tokenCounts } = await this.send('countTokens', { modelDir, dtype, texts }, { signal })
    return tokenCounts
  }

  private resolveModel(): { modelDir: string; dtype: string } {
    const bundle = bundleForCapability('embedding')
    const modelDir = localModelStorageService.resolveInstalledDir(bundle)
    const artifactsReady = bundle.requires.every((id) => localModelStorageService.isArtifactReady(id))
    if (!modelDir || !artifactsReady) throw new Error('the local embedding model is not fully downloaded')
    return { modelDir, dtype: bundleDtype(bundle) }
  }
}
