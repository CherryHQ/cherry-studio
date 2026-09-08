/**
 * Embedding request handlers (transformers.js / Qwen3-Embedding), split from the entry
 * module so they can be exercised in-process against a fake transformers package —
 * `inferenceEmbedding.ts` only wires them to the parent port.
 */

import { l2normalize } from '@main/ai/localModel/capabilities/embedding/pooling'
import type { EmbeddingModelDir } from '@main/ai/localModel/capabilities/embedding/protocol'
import type { EmbeddingInferenceContract } from '@main/ai/localModel/runtime/inferenceProcess'
import type { UtilityProcessHandlers } from '@main/core/utilityProcess/runtime/serveUtilityProcess'

import { cacheResource, currentRuntimeProfile, getTransformers, withHardwareFallback } from './inferenceRuntime'

/**
 * Load the cached model straight off disk. The model id is an absolute directory, which
 * transformers.js rejects as a repo id (isValidHfModelId) — and every remote branch in its
 * resolver is gated on that check, so file discovery cannot reach the network no matter
 * what `revision`/`local_files_only` its internal stages default to. That matters because
 * 4.2.0 drops both options before discovery (get_pipeline_files -> get_files -> get_config /
 * get_tokenizer_files), which is what made a ModelScope-only cache unusable offline.
 */
function getLocalPipeline(modelDir: EmbeddingModelDir, dtype: string, logger: { info: (m: string) => void }) {
  return cacheResource(`${modelDir}|${dtype}`, async () => {
    const { pipeline } = getTransformers()
    const profile = currentRuntimeProfile()
    const extractor = await pipeline('feature-extraction', modelDir, {
      dtype,
      device: profile.transformersDevice,
      session_options: profile.embeddingSessionOptions || profile.sessionOptions
    })
    if (profile.id !== 'cpu') logger.info(`hardware provider active provider=${profile.id} runtime=embedding`)
    return extractor
  })
}

export const embeddingHandlers: UtilityProcessHandlers<EmbeddingInferenceContract> = {
  embed: ({ modelDir, dtype, texts }, { logger }) =>
    withHardwareFallback(
      async () => {
        const extractor = await getLocalPipeline(modelDir, dtype, logger)
        const vectors: number[][] = []
        for (const text of texts) {
          // pooling:'none' -> tensor of shape [batch=1, sequence, hidden].
          const output = await extractor(text, { pooling: 'none', normalize: false })
          const sequenceLength = output.dims[1]
          const tokens = output.tolist()[0]
          vectors.push(l2normalize(tokens[sequenceLength - 1]))
        }
        return vectors
      },
      { logger, describeRequest: () => `request=embedding.embed modelDir=${JSON.stringify(modelDir)}` }
    ),

  countTokens: ({ modelDir, dtype, texts }, { logger }) =>
    withHardwareFallback(
      async () => {
        const extractor = await getLocalPipeline(modelDir, dtype, logger)
        return texts.map((text) => extractor.tokenizer.encode(text, { add_special_tokens: true }).length)
      },
      { logger, describeRequest: () => `request=embedding.countTokens modelDir=${JSON.stringify(modelDir)}` }
    )
}
