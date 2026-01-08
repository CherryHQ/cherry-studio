import { objectValues } from '@types'

export const RERANKER_PROVIDERS = {
  VOYAGEAI: 'voyageai',
  BAILIAN: 'bailian',
  JINA: 'jina',
  TEI: 'tei'
} as const

export type RerankProvider = (typeof RERANKER_PROVIDERS)[keyof typeof RERANKER_PROVIDERS]

export function isTEIProvider(provider?: string): boolean {
  return provider?.includes(RERANKER_PROVIDERS.TEI) ?? false
}

export function isKnownProvider(provider?: string): provider is RerankProvider {
  if (!provider) return false
  return objectValues(RERANKER_PROVIDERS).some((p) => p === provider)
}
