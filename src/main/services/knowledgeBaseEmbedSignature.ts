import type { KnowledgeBaseParams } from '@types'

/**
 * Stable signature for main-process RAG cache invalidation when embedding client
 * configuration changes (e.g. API key rotation). Not for logging.
 */
export function getKnowledgeBaseEmbedCacheSignature(base: KnowledgeBaseParams): string {
  const { embedApiClient, dimensions, documentCount } = base
  return JSON.stringify({
    d: dimensions ?? null,
    dc: documentCount ?? null,
    m: embedApiClient.model,
    p: embedApiClient.provider,
    k: embedApiClient.apiKey,
    u: embedApiClient.baseURL,
    v: embedApiClient.apiVersion ?? null
  })
}
