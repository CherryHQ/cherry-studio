export const RERANKER_PROVIDERS = {
  VOYAGEAI: 'voyageai',
  BAILIAN: 'bailian',
  JINA: 'jina',
  TEI: 'tei'
} as const

export type RerankProvider = (typeof RERANKER_PROVIDERS)[keyof typeof RERANKER_PROVIDERS]

export function isTEIProvider(provider: string | undefined): boolean {
  return provider?.includes(RERANKER_PROVIDERS.TEI) ?? false
}

export function isKnownProvider(provider: string | undefined): provider is RerankProvider {
  if (!provider) return false
  return Object.values(RERANKER_PROVIDERS).includes(provider as RerankProvider)
}
