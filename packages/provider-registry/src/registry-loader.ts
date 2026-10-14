/**
 * Registry Loader — read, validate, cache, and query registry JSON data.
 *
 * Cached data auto-expires after an idle period (default 30s).
 * Any access resets the timer. When the timer fires, all data and indexes
 * are released — the next access triggers a fresh load from disk.
 */

import { readFileSync } from 'node:fs'

import semver from 'semver'

import { type CatalogManifest, REGISTRY_SCHEMA_VERSION } from './catalog'
import { ModelIndex, ProviderModelIndex } from './registry-index'
import type { ModelConfig } from './schemas/model'
import { ModelListSchema } from './schemas/model'
import type { ProviderConfig } from './schemas/provider'
import { ProviderListSchema } from './schemas/provider'
import type { ProviderModelOverride } from './schemas/provider-models'
import { ProviderModelListSchema } from './schemas/provider-models'

// Re-export the top-level list schemas so Node-side consumers (e.g. the remote
// registry updater) can validate a downloaded payload in memory before writing
// it to disk — the same schemas this loader validates with on read.
export { ModelListSchema } from './schemas/model'
export { ProviderListSchema } from './schemas/provider'
export { ProviderModelListSchema } from './schemas/provider-models'

export type { CatalogManifest, RegistryFileName, RemoteRegistryFileName } from './catalog'
export {
  CatalogManifestSchema,
  REGISTRY_FILES,
  REGISTRY_MIN_APP_VERSION,
  REGISTRY_SCHEMA_VERSION,
  REMOTE_REGISTRY_FILES
} from './catalog'

/** Whether this app lies inside the manifest's explicit semantic and freshness range. */
export function isCatalogManifestCompatible(manifest: CatalogManifest, appVersion: string): boolean {
  if (manifest.schemaVersion !== REGISTRY_SCHEMA_VERSION) return false
  const app = semver.coerce(appVersion)?.version
  const minimum = semver.coerce(manifest.minAppVersion)?.version
  const source = semver.coerce(manifest.sourceAppVersion)?.version
  if (!app || !minimum || !source) return false
  return semver.gte(app, minimum) && semver.lte(app, source)
}

function readAndParse<T>(jsonPath: string, schema: { parse: (data: unknown) => T }): T {
  try {
    const data = JSON.parse(readFileSync(jsonPath, 'utf-8'))
    return schema.parse(data)
  } catch (error) {
    throw new Error(`Failed to load registry file: ${jsonPath}`, { cause: error })
  }
}

export function readModelRegistry(jsonPath: string): { version: string; models: ModelConfig[] } {
  const registry = readAndParse(jsonPath, ModelListSchema)
  return { version: registry.version, models: registry.models }
}

export function readProviderRegistry(jsonPath: string): { version: string; providers: ProviderConfig[] } {
  const registry = readAndParse(jsonPath, ProviderListSchema)
  return { version: registry.version, providers: registry.providers }
}

export function readProviderModelRegistry(jsonPath: string): { version: string; overrides: ProviderModelOverride[] } {
  const registry = readAndParse(jsonPath, ProviderModelListSchema)
  return { version: registry.version, overrides: registry.overrides }
}

export interface RegistryPaths {
  models: string
  providers: string
  providerModels: string
}

/** Default idle TTL in milliseconds (30 seconds). */
const DEFAULT_IDLE_TTL_MS = 30_000

/**
 * Cached registry data with pre-computed indexes and idle auto-expiry.
 *
 * Data is lazily loaded on first access, indexes are built once after load,
 * and everything is released after {@link idleTtlMs} of no access.
 */
export class RegistryLoader {
  private models: ModelConfig[] | null = null
  private providers: ProviderConfig[] | null = null
  private providerModels: ProviderModelOverride[] | null = null
  private modelsVersion: string | null = null
  private providersVersion: string | null = null
  private providerModelsVersion: string | null = null

  private modelIndex: ModelIndex | null = null
  private overrideIndex: ProviderModelIndex | null = null

  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private readonly idleTtlMs: number

  constructor(
    private readonly paths: RegistryPaths,
    idleTtlMs?: number
  ) {
    this.idleTtlMs = idleTtlMs ?? DEFAULT_IDLE_TTL_MS
  }

  /** Reset the idle timer. Called on every public access. */
  private touch(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => this.invalidate(), this.idleTtlMs)
  }

  /** Load and cache models.json. Returns models array. */
  loadModels(): ModelConfig[] {
    this.touch()
    if (this.models) return this.models
    const data = readModelRegistry(this.paths.models)
    this.models = data.models ?? []
    this.modelsVersion = data.version
    this.modelIndex = new ModelIndex(this.models)
    return this.models
  }

  /** Load and cache providers.json. Returns providers array. */
  loadProviders(): ProviderConfig[] {
    this.touch()
    if (this.providers) return this.providers
    const data = readProviderRegistry(this.paths.providers)
    this.providers = data.providers ?? []
    this.providersVersion = data.version
    return this.providers
  }

  /** Load and cache provider-models.json. Returns overrides array. */
  loadProviderModels(): ProviderModelOverride[] {
    this.touch()
    if (this.providerModels) return this.providerModels
    const data = readProviderModelRegistry(this.paths.providerModels)
    this.providerModels = data.overrides ?? []
    this.providerModelsVersion = data.version
    this.overrideIndex = new ProviderModelIndex(this.providerModels)
    return this.providerModels
  }

  /** Get the models.json version string. */
  getModelsVersion(): string {
    this.loadModels()
    return this.modelsVersion!
  }

  /** Get the providers.json version string. */
  getProvidersVersion(): string {
    this.loadProviders()
    return this.providersVersion!
  }

  /** Get the provider-models.json version string. */
  getProviderModelsVersion(): string {
    this.loadProviderModels()
    return this.providerModelsVersion!
  }

  findProvider(providerId: string): ProviderConfig | null {
    const providers = this.loadProviders()
    return providers.find((p) => p.id === providerId) ?? null
  }

  findModel(modelId: string): ModelConfig | null {
    this.loadModels()
    return this.modelIndex!.findModel(modelId)
  }

  findOverride(providerId: string, modelId: string): ProviderModelOverride | null {
    this.loadProviderModels()
    return this.overrideIndex!.findOverride(providerId, modelId)
  }

  getOverridesForProvider(providerId: string): ProviderModelOverride[] {
    this.loadProviderModels()
    return this.overrideIndex!.getOverridesForProvider(providerId)
  }

  /** Release all cached data and indexes. Next access triggers a fresh load. */
  invalidate(): void {
    this.models = null
    this.providers = null
    this.providerModels = null
    this.modelsVersion = null
    this.providersVersion = null
    this.providerModelsVersion = null
    this.modelIndex = null
    this.overrideIndex = null
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
  }
}
