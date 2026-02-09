import { loggerService } from '@logger'

import type { EmbeddingProvider } from '../types'

const logger = loggerService.withContext('EmbeddingProviderRegistry')

/**
 * Registry for embedding providers following OCP
 * New providers can be added without modifying resolver logic
 */
export class EmbeddingProviderRegistry {
  private providers: Map<string, EmbeddingProvider> = new Map()
  private fallbackProvider: EmbeddingProvider | null = null

  /**
   * Register a provider for a specific ID
   * @param provider Provider implementation
   */
  register(provider: EmbeddingProvider): void {
    this.providers.set(provider.providerId, provider)
    logger.debug(`Registered embedding provider: ${provider.providerId}`)
  }

  /**
   * Set the fallback provider for unknown provider IDs
   * @param provider Fallback provider (typically OpenAI-compatible)
   */
  setFallback(provider: EmbeddingProvider): void {
    this.fallbackProvider = provider
    logger.debug(`Set fallback embedding provider: ${provider.providerId}`)
  }

  /**
   * Resolve provider for a given provider ID
   * @param providerId Provider identifier from ApiClient
   * @returns Matching provider or fallback
   * @throws Error if no provider found and no fallback set
   */
  resolve(providerId: string): EmbeddingProvider {
    const directMatch = this.providers.get(providerId)
    if (directMatch) {
      return directMatch
    }

    if (this.fallbackProvider) {
      logger.debug(`Using fallback provider for: ${providerId}`)
      return this.fallbackProvider
    }

    throw new Error(`No embedding provider found for: ${providerId}`)
  }

  /**
   * Check if a provider is registered for the given ID
   */
  has(providerId: string): boolean {
    return this.providers.has(providerId)
  }

  /**
   * Get all registered provider IDs
   */
  getRegisteredIds(): string[] {
    return Array.from(this.providers.keys())
  }
}
