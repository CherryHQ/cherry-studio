import type { RerankProvider } from '../types'
import { RerankProviderRegistry } from './RerankProviderRegistry'

export { RerankProviderRegistry } from './RerankProviderRegistry'

/**
 * Singleton instance of the rerank provider registry
 */
export const rerankProviderRegistry = new RerankProviderRegistry()

/**
 * Helper function to resolve provider from provider ID
 */
export function resolveRerankProvider(providerId?: string): RerankProvider {
  return rerankProviderRegistry.resolve(providerId)
}
