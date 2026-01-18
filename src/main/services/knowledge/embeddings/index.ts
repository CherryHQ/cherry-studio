// Import providers to trigger auto-registration
import './providers'

// Main class export (default for backward compatibility)
export { default as Embeddings } from './Embeddings'
export { default } from './Embeddings'

// Registry exports for extensibility
export { embeddingProviderRegistry, resolveEmbeddingProvider } from './registry'
export { EmbeddingProviderRegistry } from './registry/EmbeddingProviderRegistry'

// Type exports
export type { EmbeddingProvider, EmbeddingProviderOptions, EmbeddingsConfig } from './types'
export { EMBEDDING_PROVIDERS } from './types'

// Provider exports for direct use/extension
export { OllamaProvider, OpenAICompatibleProvider, OpenAIProvider } from './providers'
