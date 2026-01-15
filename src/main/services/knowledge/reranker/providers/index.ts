import { rerankProviderRegistry } from '../registry'
import { BailianProvider } from './BailianProvider'
import { DefaultProvider } from './DefaultProvider'
import { JinaProvider } from './JinaProvider'
import { TEIProvider } from './TeiProvider'
import { VoyageAIProvider } from './VoyageProvider'

export { BailianProvider } from './BailianProvider'
export { DefaultProvider } from './DefaultProvider'
export { JinaProvider } from './JinaProvider'
export { TEIProvider } from './TeiProvider'
export { VoyageAIProvider } from './VoyageProvider'

/**
 * Register all built-in providers
 * Called on module import to ensure providers are available
 */
function registerBuiltInProviders(): void {
  rerankProviderRegistry.register(new VoyageAIProvider())
  rerankProviderRegistry.register(new BailianProvider())
  rerankProviderRegistry.register(new JinaProvider())
  rerankProviderRegistry.register(new TEIProvider())

  // Set Default as fallback for unknown providers
  rerankProviderRegistry.setFallback(new DefaultProvider())
}

// Auto-register on import
registerBuiltInProviders()
