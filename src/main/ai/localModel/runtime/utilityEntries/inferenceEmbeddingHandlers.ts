/**
 * Embedding request handlers (transformers.js), split from the entry
 * module so they can be exercised in-process against a fake transformers package —
 * `inferenceEmbedding.ts` only wires them to the parent port.
 *
 * Two builtin embedding models share this runtime with different ONNX outputs:
 * - Qwen3-Embedding returns per-token `last_hidden_state`, so the handler takes
 *   the last token (matching Qwen's expected pooling).
 * - Harrier 270M is a decoder-only model whose graph returns only `sentence_embedding`
 *   (already last-token pooled + L2-normalized). Transformers.js 4.2.0's
 *   feature-extraction pipeline only looks for `last_hidden_state`/`logits`/
 *   `token_embeddings`, so it resolves to `undefined` for Harrier.
 *
 * Both paths run exactly one forward per text: tokenize once, invoke the cached
 * model once, then consume either the token tensor or the pooled output. Calling
 * the feature-extraction pipeline first and then the model again would double
 * Harrier inference (the pipeline forward already runs the model internally).
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
          // Single forward per text for both models: the pipeline call itself
          // runs `extractor.model` internally, so calling the pipeline and then
          // the model again would run Harrier inference twice per text.
          const modelInputs = extractor.tokenizer(text, { padding: true, truncation: true })
          const modelOutputs = await extractor.model(modelInputs)
          // Qwen path: per-token tensor of shape [batch=1, sequence, hidden].
          const tokenTensor = modelOutputs?.last_hidden_state ?? modelOutputs?.logits ?? modelOutputs?.token_embeddings
          if (tokenTensor?.dims?.length === 3) {
            const sequenceLength = tokenTensor.dims[1]
            const tokens = tokenTensor.tolist()[0]
            vectors.push(l2normalize(tokens[sequenceLength - 1]))
            continue
          }
          // Harrier path: graph returns only the pooled `sentence_embedding`.
          const pooled = modelOutputs?.sentence_embedding ?? modelOutputs?.pooler_output
          if (pooled?.dims?.length === 2) {
            vectors.push(l2normalize(pooled.tolist()[0]))
            continue
          }
          throw new Error(
            `embedding model returned unsupported output tokenDims=${JSON.stringify(tokenTensor?.dims)} pooledDims=${JSON.stringify(pooled?.dims)}`
          )
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
