import { application } from '@application'
import type { FeatureExtractionPipeline } from '@huggingface/transformers'
import { loggerService } from '@logger'

const logger = loggerService.withContext('LocalEmbeddingRuntime')

/** HF ONNX community repo + quantization variant for the local embedding model. */
const MODEL_REPO = 'onnx-community/Qwen3-Embedding-0.6B-ONNX'
const MODEL_DTYPE = 'q8'

let pipelinePromise: Promise<FeatureExtractionPipeline> | null = null

async function getPipeline(): Promise<FeatureExtractionPipeline> {
  if (!pipelinePromise) {
    // transformers.js pulls in onnxruntime-node (native CPU) lazily on first
    // use; the dynamic import keeps the heavy library + native runtime out of
    // boot until the knowledge base actually needs a local embedding.
    pipelinePromise = (async () => {
      const { pipeline, env } = await import('@huggingface/transformers')
      env.allowRemoteModels = true
      env.cacheDir = application.getPath('feature.models.transformers')
      logger.info('Loading local embedding model', { repo: MODEL_REPO, dtype: MODEL_DTYPE })
      const extractor = await pipeline('feature-extraction', MODEL_REPO, {
        dtype: MODEL_DTYPE,
        device: 'cpu'
      })
      logger.info('Local embedding model ready')
      return extractor
    })()
    // Drop the cached promise on failure (e.g. a download error) so the next
    // call can retry instead of permanently rejecting.
    pipelinePromise.catch(() => {
      pipelinePromise = null
    })
  }
  return pipelinePromise
}

function l2normalize(vector: number[]): number[] {
  let sumSquares = 0
  for (const value of vector) sumSquares += value * value
  const norm = Math.sqrt(sumSquares)
  return norm === 0 ? vector : vector.map((value) => value / norm)
}

/**
 * Embed texts using Qwen3-Embedding's last-token pooling.
 *
 * transformers.js feature-extraction only offers `mean` / `cls` / `none`
 * pooling, so we request `pooling:'none'` (full per-token embeddings), take the
 * final token, then L2-normalize — matching Qwen3-Embedding's expected pooling.
 * Texts are embedded sequentially for correctness; batched last-token pooling
 * (with attention-mask handling) is a later performance optimization.
 */
export async function embedTexts(texts: string[], signal?: AbortSignal): Promise<number[][]> {
  if (texts.length === 0) return []
  const extractor = await getPipeline()
  const vectors: number[][] = []
  for (const text of texts) {
    if (signal?.aborted) throw signal.reason ?? new Error('Local embedding aborted')
    // pooling:'none' → tensor of shape [batch=1, sequence, hidden].
    const output = await extractor(text, { pooling: 'none', normalize: false })
    const sequenceLength = output.dims[1]
    const tokens = output.tolist()[0] as number[][]
    vectors.push(l2normalize(tokens[sequenceLength - 1]))
  }
  return vectors
}
