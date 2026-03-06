import type { ApiClient } from '@types'

import type { EmbeddingProvider } from '../types'
import { EmbeddingProviderRegistry } from './EmbeddingProviderRegistry'

export { EmbeddingProviderRegistry } from './EmbeddingProviderRegistry'

/**
 * Singleton instance of the embedding provider registry
 */
export const embeddingProviderRegistry = new EmbeddingProviderRegistry()

/**
 * Helper function to resolve provider from ApiClient
 * Preserves backward compatibility with original resolveEmbeddingProvider
 */
export function resolveEmbeddingProvider(client: ApiClient): EmbeddingProvider {
  return embeddingProviderRegistry.resolve(client.provider)
}
