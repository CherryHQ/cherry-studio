import { application } from '@application'
import { LOCAL_EMBEDDING_MAX_INPUT_TOKENS, LOCAL_EMBEDDING_MAX_OVERLAP_TOKENS } from '@main/ai/localModel'
import type { KnowledgeBase } from '@shared/data/types/knowledge'

import type { ChunkedKnowledgeContent } from './chunk'
import { refineChunksByTokenLimit } from './tokenLimit'

type CountTokens = (text: string) => Promise<number>

export async function refineLocalEmbeddingChunks(
  base: KnowledgeBase,
  chunked: ChunkedKnowledgeContent,
  signal?: AbortSignal
): Promise<ChunkedKnowledgeContent> {
  const countTokens = await getLocalEmbeddingTokenCounter(signal)
  const maxTokens = Math.min(base.chunkSize, LOCAL_EMBEDDING_MAX_INPUT_TOKENS)
  const overlapTokens = Math.min(base.chunkOverlap, LOCAL_EMBEDDING_MAX_OVERLAP_TOKENS, maxTokens - 1)

  return refineChunksByTokenLimit(chunked, {
    maxTokens,
    overlapTokens,
    countTokens
  })
}

/** Counts tokens on the inference worker's already-loaded pipeline — the main
 * process must never import `@huggingface/transformers` itself, since that
 * transitively requires onnxruntime-node's native binding (see
 * patches/onnxruntime-node@1.25.1.patch). */
async function getLocalEmbeddingTokenCounter(signal?: AbortSignal): Promise<CountTokens> {
  return async (text: string) => {
    const [count] = await application.get('EmbeddingInferenceService').countTokens([text], signal)
    return count
  }
}
