import { application } from '@application'
import {
  LOCAL_EMBEDDING_MAX_INPUT_TOKENS,
  LOCAL_EMBEDDING_MAX_OVERLAP_TOKENS
} from '@main/ai/inference/localEmbeddingLimits'
import { LOCAL_MODELS } from '@main/ai/inference/localModelCatalog'
import { currentModelSource } from '@main/ai/provider/custom/localEmbedding/localEmbeddingRuntime'
import type { KnowledgeBase } from '@shared/data/types/knowledge'

import type { ChunkedKnowledgeContent } from './chunk'
import { refineChunksByTokenLimit } from './tokenLimit'

type CountTokens = (text: string) => number

let tokenCounterPromise: Promise<CountTokens> | null = null

export async function refineLocalEmbeddingChunks(
  base: KnowledgeBase,
  chunked: ChunkedKnowledgeContent
): Promise<ChunkedKnowledgeContent> {
  const countTokens = await getLocalEmbeddingTokenCounter()
  const maxTokens = Math.min(base.chunkSize, LOCAL_EMBEDDING_MAX_INPUT_TOKENS)
  const overlapTokens = Math.min(base.chunkOverlap, LOCAL_EMBEDDING_MAX_OVERLAP_TOKENS, maxTokens - 1)

  return refineChunksByTokenLimit(chunked, {
    maxTokens,
    overlapTokens,
    countTokens
  })
}

export async function getLocalEmbeddingTokenCounter(): Promise<CountTokens> {
  tokenCounterPromise ??= loadLocalEmbeddingTokenCounter().catch((error: unknown) => {
    tokenCounterPromise = null
    throw error
  })
  return tokenCounterPromise
}

async function loadLocalEmbeddingTokenCounter(): Promise<CountTokens> {
  const { AutoTokenizer, env } = await import('@huggingface/transformers')
  const source = await currentModelSource()
  env.allowRemoteModels = true
  env.cacheDir = application.getPath('feature.embedding.models')
  env.remoteHost = source.remoteHost
  env.remotePathTemplate = source.remotePathTemplate

  const tokenizer = await AutoTokenizer.from_pretrained(LOCAL_MODELS.embedding.repo, { revision: source.revision })
  return (text: string) => tokenizer.encode(text, { add_special_tokens: true }).length
}
