import type { ApiClient } from '@types'
import type { EmbeddingModel } from 'ai'

/**
 * Provider options for embedding API calls
 * Maps provider name to dimension configuration
 */
export type EmbeddingProviderOptions = Record<string, { dimensions: number }> | undefined

/**
 * Core interface for all embedding providers
 * Follows Interface Segregation Principle - only essential methods
 */
export interface EmbeddingProvider {
  /**
   * Provider identifier for registry lookup
   */
  readonly providerId: string

  /**
   * Create an embedding model from the AI SDK
   * @param client API client configuration
   * @returns Configured embedding model
   */
  createModel(client: ApiClient): EmbeddingModel<string>

  /**
   * Build provider-specific options for embedding calls
   * @param dimensions Optional dimension override
   * @returns Provider options or undefined if not applicable
   */
  buildProviderOptions(dimensions?: number): EmbeddingProviderOptions
}

/**
 * Configuration for the Embeddings class
 */
export interface EmbeddingsConfig {
  embedApiClient: ApiClient
  dimensions?: number
}

/**
 * Known provider identifiers as const object for type safety
 */
export const EMBEDDING_PROVIDERS = {
  OPENAI: 'openai',
  OLLAMA: 'ollama',
  OPENAI_COMPATIBLE: 'openai-compatible'
} as const
