import { ModelIndex, ProviderModelIndex } from './registry-index'
import { type ModelConfig, ModelListSchema } from './schemas/model'
import type { ProviderConfig } from './schemas/provider'
import { type ProviderModelOverride, ProviderModelListSchema } from './schemas/provider-models'

export interface ModelSnapshot {
  readonly models: { readonly version: string; readonly models: readonly ModelConfig[] }
  readonly providerModels: { readonly version: string; readonly overrides: readonly ProviderModelOverride[] }
}

export interface RegistryCatalog extends ModelSnapshot {
  readonly providers: { readonly version: string; readonly providers: readonly ProviderConfig[] }
}

export interface Registry {
  listProviders(): readonly ProviderConfig[]
  listModels(): readonly ModelConfig[]
  getOverridesForProvider(providerId: string): readonly ProviderModelOverride[]
  findProvider(providerId: string): ProviderConfig | null
  findModel(modelId: string): ModelConfig | null
  findOverride(providerId: string, modelId: string): ProviderModelOverride | null
}

/** Parse untrusted model metadata; provider routing is supplied separately by the application. */
export function parseModelSnapshot(input: { models: unknown; providerModels: unknown }): ModelSnapshot {
  return {
    models: ModelListSchema.parse(input.models),
    providerModels: ProviderModelListSchema.parse(input.providerModels)
  }
}

/** Build a query view over a validated catalog. Treat the input and returned records as read-only. */
export function createRegistry(catalog: RegistryCatalog): Registry {
  const models = [...catalog.models.models]
  const providers = [...catalog.providers.providers]
  const modelIndex = new ModelIndex(models)
  const overrideIndex = new ProviderModelIndex(catalog.providerModels.overrides)
  return {
    listModels: () => models,
    listProviders: () => providers,
    findProvider: (id) => providers.find((provider) => provider.id === id) ?? null,
    findModel: (id) => modelIndex.findModel(id),
    findOverride: (providerId, modelId) => overrideIndex.findOverride(providerId, modelId),
    getOverridesForProvider: (providerId) => overrideIndex.getOverridesForProvider(providerId)
  }
}
