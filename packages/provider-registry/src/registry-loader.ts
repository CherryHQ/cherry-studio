/**
 * Registry Loader — read, validate, cache, and query registry JSON data.
 *
 * Combines JSON reading (fs + Zod validation) with cached access and
 * pure lookup/transformation utilities.
 */

import { readFileSync } from 'node:fs'

import type { ModelConfig } from './schemas/model'
import { ModelListSchema } from './schemas/model'
import type { ProviderConfig } from './schemas/provider'
import { ProviderListSchema } from './schemas/provider'
import type { ProviderModelOverride } from './schemas/provider-models'
import { ProviderModelListSchema } from './schemas/provider-models'

export function readModelRegistry(jsonPath: string): { version: string; models: ModelConfig[] } {
  const data = JSON.parse(readFileSync(jsonPath, 'utf-8'))
  const registry = ModelListSchema.parse(data)
  return { version: registry.version, models: registry.models }
}

export function readProviderRegistry(jsonPath: string): { version: string; providers: ProviderConfig[] } {
  const data = JSON.parse(readFileSync(jsonPath, 'utf-8'))
  const registry = ProviderListSchema.parse(data)
  return { version: registry.version, providers: registry.providers }
}

export function readProviderModelRegistry(jsonPath: string): { version: string; overrides: ProviderModelOverride[] } {
  const data = JSON.parse(readFileSync(jsonPath, 'utf-8'))
  const registry = ProviderModelListSchema.parse(data)
  return { version: registry.version, overrides: registry.overrides }
}

export interface RegistryPaths {
  models: string
  providers: string
  providerModels: string
}

/**
 * Cached registry data holder.
 * Call `load()` once at startup, then use getters.
 */
export class RegistryLoader {
  private models: ModelConfig[] | null = null
  private providers: ProviderConfig[] | null = null
  private providerModels: ProviderModelOverride[] | null = null
  private modelsVersion: string | null = null
  private providersVersion: string | null = null

  constructor(private readonly paths: RegistryPaths) {}

  /** Load and cache models.json. Returns models array. */
  loadModels(): ModelConfig[] {
    if (this.models) return this.models
    const data = readModelRegistry(this.paths.models)
    this.models = data.models ?? []
    this.modelsVersion = data.version
    return this.models
  }

  /** Load and cache providers.json. Returns providers array. */
  loadProviders(): ProviderConfig[] {
    if (this.providers) return this.providers
    const data = readProviderRegistry(this.paths.providers)
    this.providers = data.providers ?? []
    this.providersVersion = data.version
    return this.providers
  }

  /** Load and cache provider-models.json. Returns overrides array. */
  loadProviderModels(): ProviderModelOverride[] {
    if (this.providerModels) return this.providerModels
    const data = readProviderModelRegistry(this.paths.providerModels)
    this.providerModels = data.overrides ?? []
    return this.providerModels
  }

  /** Get the models.json version string (loads if not yet loaded). */
  getModelsVersion(): string {
    this.loadModels()
    return this.modelsVersion!
  }

  /** Get the providers.json version string (loads if not yet loaded). */
  getProvidersVersion(): string {
    this.loadProviders()
    return this.providersVersion!
  }

  /** Clear all cached data (useful for testing). */
  clearCache(): void {
    this.models = null
    this.providers = null
    this.providerModels = null
    this.modelsVersion = null
    this.providersVersion = null
  }
}
