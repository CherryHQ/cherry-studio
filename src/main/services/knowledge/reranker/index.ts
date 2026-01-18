// Import providers to trigger auto-registration
import './providers'

// Main exports
export { default as BaseReranker } from './BaseReranker'
export { default as GeneralReranker } from './GeneralReranker'
export { default as Reranker } from './Reranker'

// Registry exports for extensibility
export { rerankProviderRegistry, resolveRerankProvider } from './registry'
export { RerankProviderRegistry } from './registry/RerankProviderRegistry'

// Type exports
export type { MultiModalDocument, RerankProvider, RerankProviderId, RerankResultItem } from './types'
export { isTEIProvider, RERANKER_PROVIDERS } from './types'

// Provider exports for direct use/extension
export {
  BailianProvider,
  DefaultProvider,
  JinaProvider,
  TEIProvider,
  VoyageAIProvider
} from './providers'
