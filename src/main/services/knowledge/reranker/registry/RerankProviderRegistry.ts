import { loggerService } from '@logger'

import type { RerankProvider, RerankProviderId } from '../types'

const logger = loggerService.withContext('RerankProviderRegistry')

/**
 * Registry for rerank providers following OCP
 * New providers can be added without modifying resolver logic
 */
export class RerankProviderRegistry {
  private providers: Map<RerankProviderId, RerankProvider> = new Map()
  private fallbackProvider: RerankProvider | null = null

  /**
   * Register a provider for a specific provider ID
   * @param provider Provider implementation
   */
  register(provider: RerankProvider): void {
    this.providers.set(provider.providerId, provider)
    logger.debug(`Registered rerank provider: ${provider.providerId}`)
  }

  /**
   * Set the fallback provider for unknown provider IDs
   * @param provider Fallback provider (typically Default)
   */
  setFallback(provider: RerankProvider): void {
    this.fallbackProvider = provider
    logger.debug(`Set fallback rerank provider: ${provider.providerId}`)
  }

  /**
   * Resolve provider for a given provider ID
   * @param providerId Provider identifier
   * @returns Matching provider or fallback
   * @throws Error if no provider found and no fallback set
   */
  resolve(providerId?: string): RerankProvider {
    if (providerId) {
      // Direct match
      const directMatch = this.providers.get(providerId)
      if (directMatch) {
        return directMatch
      }

      // Check providers with custom matching logic
      for (const provider of this.providers.values()) {
        if (provider.matches?.(providerId)) {
          return provider
        }
      }
    }

    // Use fallback
    if (this.fallbackProvider) {
      logger.debug(`Using fallback provider for: ${providerId}`)
      return this.fallbackProvider
    }

    throw new Error(`No rerank provider found for: ${providerId}`)
  }

  /**
   * Check if a provider is registered for the given ID
   */
  has(providerId: RerankProviderId): boolean {
    return this.providers.has(providerId)
  }

  /**
   * Get all registered provider IDs
   */
  getRegisteredIds(): RerankProviderId[] {
    return Array.from(this.providers.keys())
  }
}
