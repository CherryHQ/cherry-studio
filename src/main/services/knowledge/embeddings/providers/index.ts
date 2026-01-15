import { embeddingProviderRegistry } from '../registry'
import { OllamaProvider } from './OllamaProvider'
import { OpenAICompatibleProvider } from './OpenAICompatibleProvider'
import { OpenAIProvider } from './OpenAIProvider'

export { OllamaProvider } from './OllamaProvider'
export { OpenAICompatibleProvider } from './OpenAICompatibleProvider'
export { OpenAIProvider } from './OpenAIProvider'

/**
 * Register all built-in providers
 * Called on module import to ensure providers are available
 */
function registerBuiltInProviders(): void {
  embeddingProviderRegistry.register(new OpenAIProvider())
  embeddingProviderRegistry.register(new OllamaProvider())

  // Set OpenAI-compatible as fallback for unknown providers
  embeddingProviderRegistry.setFallback(new OpenAICompatibleProvider())
}

// Auto-register on import
registerBuiltInProviders()
