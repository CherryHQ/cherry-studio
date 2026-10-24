import {
  createRegistry,
  type ModelConfig,
  type ProviderConfig,
  type ProviderModelOverride
} from '@cherrystudio/provider-registry'

// The package's `dist` is not built in the workspace; the desktop also resolves it from source.
import { bundledCatalog } from '../../../provider-registry/src/bundled-catalog'

/**
 * Browser `@cherrystudio/provider-registry/node` and `registryDataPaths`: the desktop loads the
 * catalog JSON from disk, the Worker serves the catalog bundled into the build. Remote catalog
 * overrides are desktop-only.
 */
export function resolveRegistryPaths() {
  return { models: 'bundled', providers: 'bundled', providerModels: 'bundled' }
}

export class RegistryLoader {
  readonly #registry = createRegistry(bundledCatalog)

  loadModels(): ModelConfig[] {
    return [...this.#registry.listModels()]
  }

  loadProviders(): ProviderConfig[] {
    return [...this.#registry.listProviders()]
  }

  loadProviderModels(): ProviderModelOverride[] {
    return [...bundledCatalog.providerModels.overrides]
  }

  getModelsVersion(): string {
    return bundledCatalog.models.version
  }

  getProvidersVersion(): string {
    return bundledCatalog.providers.version
  }

  getProviderModelsVersion(): string {
    return bundledCatalog.providerModels.version
  }

  findProvider(providerId: string): ProviderConfig | null {
    return this.#registry.findProvider(providerId)
  }

  findModel(modelId: string): ModelConfig | null {
    return this.#registry.findModel(modelId)
  }

  findOverride(providerId: string, modelId: string): ProviderModelOverride | null {
    return this.#registry.findOverride(providerId, modelId)
  }

  getOverridesForProvider(providerId: string): ProviderModelOverride[] {
    return [...this.#registry.getOverridesForProvider(providerId)]
  }

  invalidate(): void {}
}
