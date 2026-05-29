/**
 * Registry Loader — read, validate, cache, and query registry JSON data.
 *
 * Cached data auto-expires after an idle period (default 30s).
 * Any access resets the timer. When the timer fires, all data and indexes
 * are released — the next access triggers a fresh load from disk.
 */

import { readFileSync } from 'node:fs'

import type { ModelConfig } from './schemas/model'
import { ModelListSchema } from './schemas/model'
import type { ProviderConfig } from './schemas/provider'
import { ProviderListSchema } from './schemas/provider'
import type { ProviderModelOverride } from './schemas/provider-models'
import { ProviderModelListSchema } from './schemas/provider-models'
import { normalizeModelId } from './utils/normalize'

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

  private modelById: Map<string, ModelConfig> | null = null
  private modelByNormId: Map<string, ModelConfig> | null = null
  private overrideByKey: Map<string, ProviderModelOverride> | null = null
  private overrideByNormKey: Map<string, ProviderModelOverride> | null = null
  private overridesByProvider: Map<string, ProviderModelOverride[]> | null = null

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
    this.buildModelIndex()
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
    this.buildOverrideIndex()
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

  private buildModelIndex(): void {
    this.modelById = new Map()
    this.modelByNormId = new Map()
    for (const m of this.models!) {
      this.modelById.set(m.id, m)
      const nid = normalizeModelId(m.id)
      if (!this.modelByNormId.has(nid)) {
        this.modelByNormId.set(nid, m)
      }
    }
  }

  private buildOverrideIndex(): void {
    this.overrideByKey = new Map()
    this.overrideByNormKey = new Map()
    this.overridesByProvider = new Map()
    for (const pm of this.providerModels!) {
      const key = `${pm.providerId}::${pm.modelId}`
      this.overrideByKey.set(key, pm)
      const normKey = `${pm.providerId}::${normalizeModelId(pm.modelId)}`
      if (!this.overrideByNormKey.has(normKey)) {
        this.overrideByNormKey.set(normKey, pm)
      }
      let arr = this.overridesByProvider.get(pm.providerId)
      if (!arr) {
        arr = []
        this.overridesByProvider.set(pm.providerId, arr)
      }
      arr.push(pm)
    }
  }

  findModel(modelId: string): ModelConfig | null {
    this.loadModels()
    return this.modelById!.get(modelId) ?? this.modelByNormId!.get(normalizeModelId(modelId)) ?? null
  }

  findOverride(providerId: string, modelId: string): ProviderModelOverride | null {
    this.loadProviderModels()
    const key = `${providerId}::${modelId}`
    return (
      this.overrideByKey!.get(key) ?? this.overrideByNormKey!.get(`${providerId}::${normalizeModelId(modelId)}`) ?? null
    )
  }

  /** O(1) get all overrides for a provider. */
  getOverridesForProvider(providerId: string): ProviderModelOverride[] {
    this.loadProviderModels()
    return this.overridesByProvider!.get(providerId) ?? []
  }

  /** Release all cached data and indexes. Next access triggers a fresh load. */
  invalidate(): void {
    this.models = null
    this.providers = null
    this.providerModels = null
    this.modelsVersion = null
    this.providersVersion = null
    this.modelById = null
    this.modelByNormId = null
    this.overrideByKey = null
    this.overrideByNormKey = null
    this.overridesByProvider = null
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
  }
}
