/**
 * Registry Loader — read, validate, cache, and query registry JSON data.
 *
 * Cached data auto-expires after an idle period (default 30s).
 * Any access resets the timer. When the timer fires, all data and indexes
 * are released — the next access triggers a fresh load from disk.
 */

import { readFileSync } from 'node:fs'

import * as z from 'zod'

import type { ModelConfig } from './schemas/model'
import { ModelListSchema } from './schemas/model'
import type { ProviderConfig } from './schemas/provider'
import { ProviderListSchema } from './schemas/provider'
import type { ProviderModelOverride } from './schemas/provider-models'
import { ProviderModelListSchema } from './schemas/provider-models'
import { normalizeModelId } from './utils/normalize'

// Re-export the top-level list schemas so Node-side consumers (e.g. the remote
// registry updater) can validate a downloaded payload in memory before writing
// it to disk — the same schemas this loader validates with on read.
export { ModelListSchema } from './schemas/model'
export { ProviderListSchema } from './schemas/provider'
export { ProviderModelListSchema } from './schemas/provider-models'

/**
 * Schema-compatibility version of the registry JSON contract.
 *
 * The remote updater fetches from a `v{REGISTRY_SCHEMA_VERSION}/` path and the
 * sync CI publishes to the matching dir, so an app only ever receives data its
 * bundled schema can parse. The sync CI derives its publish dir from this
 * constant (single source of truth).
 *
 * Bump on ANY change older clients cannot parse. That includes a new **enum
 * value** for a closed `z.enum` field (`ModalitySchema`, `ModelCapabilityTypeSchema`,
 * `ReasoningEffortSchema`, …): an unknown member makes the whole document fail
 * validation on an older client, so enum-vocabulary expansion is breaking and
 * MUST bump this — until those runtime schemas are made to tolerate unknown
 * members. Only genuinely additive changes stay compatible: new models and new
 * *optional object fields* (a plain `z.object` strips unknown keys). Structural
 * changes (field rename / retype / required-field removal) always bump.
 */
export const REGISTRY_SCHEMA_VERSION = 1

/**
 * The three JSON data files this package emits (`packages/provider-registry/data/`).
 * The canonical definition of what a full catalog consists of — consumed by the
 * app's loader-path resolution and by the remote updater's fetch loop.
 */
export const REGISTRY_FILES = ['models.json', 'providers.json', 'provider-models.json'] as const
export type RegistryFileName = (typeof REGISTRY_FILES)[number]

/**
 * Manifest published alongside each `v{N}/` catalog set (written last as the
 * completion marker). Consumed by the app's remote updater — to validate a
 * downloaded manifest and to gate a persisted override — so both parse against
 * this one schema instead of hand-rolled checks.
 */
export const CatalogManifestSchema = z.object({
  /** App release the catalog was generated for — the anti-downgrade floor. */
  releaseFloor: z.string().min(1),
  /** Schema version the set targets; must equal {@link REGISTRY_SCHEMA_VERSION} to be usable. */
  schemaVersion: z.number().int(),
  /** filename → content-hash `version`, binding the set to one published snapshot. */
  files: z.record(z.string(), z.string())
})
export type CatalogManifest = z.infer<typeof CatalogManifestSchema>

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

  private modelById: Map<string, ModelConfig> | null = null
  private modelByNormId: Map<string, ModelConfig> | null = null
  private overrideByKey: Map<string, ProviderModelOverride> | null = null
  private overrideByNormKey: Map<string, ProviderModelOverride> | null = null
  private overrideByApiKey: Map<string, ProviderModelOverride> | null = null
  private overrideByNormApiKey: Map<string, ProviderModelOverride> | null = null
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
    this.providerModelsVersion = data.version
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

  /** Get the provider-models.json version string. */
  getProviderModelsVersion(): string {
    this.loadProviderModels()
    return this.providerModelsVersion!
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
    this.overrideByApiKey = new Map()
    this.overrideByNormApiKey = new Map()
    this.overridesByProvider = new Map()
    for (const pm of this.providerModels!) {
      const key = `${pm.providerId}::${pm.modelId}`
      // `modelId` is NOT unique: a provider may serve one canonical model under several apiModelIds
      // (tokenhub's dated 原厂直供 variants share `deepseek-v4-flash`). The canonical key must resolve to
      // the undated/self variant (`apiModelId === modelId`) — the dated ones stay reachable only via the
      // apiModelId index below. Order-independent: a self variant claims the slot whenever it appears.
      if (!this.overrideByKey.has(key) || pm.apiModelId === pm.modelId) {
        this.overrideByKey.set(key, pm)
      }
      const normKey = `${pm.providerId}::${normalizeModelId(pm.modelId)}`
      if (!this.overrideByNormKey.has(normKey)) {
        this.overrideByNormKey.set(normKey, pm)
      }
      if (pm.apiModelId) {
        const apiKey = `${pm.providerId}::${pm.apiModelId}`
        this.overrideByApiKey.set(apiKey, pm)
        const normApiKey = `${pm.providerId}::${normalizeModelId(pm.apiModelId)}`
        if (!this.overrideByNormApiKey.has(normApiKey)) {
          this.overrideByNormApiKey.set(normApiKey, pm)
        }
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

  findProvider(providerId: string): ProviderConfig | null {
    const providers = this.loadProviders()
    return providers.find((p) => p.id === providerId) ?? null
  }

  findOverride(providerId: string, modelId: string): ProviderModelOverride | null {
    this.loadProviderModels()
    const key = `${providerId}::${modelId}`
    const normKey = `${providerId}::${normalizeModelId(modelId)}`
    // BOTH exact lookups (canonical modelId, then provider apiModelId) must precede BOTH normalized
    // fallbacks. `normalizeModelId` strips size/date suffixes, so several distinct rows collapse to one
    // normalized key (`google.gemma-3-27b-it` and `gemma-3-12b-it` both → `gemma-3-it`). If the normalized
    // canonical fallback ran before the exact apiModelId map, an exact SDK id like `google.gemma-3-27b-it`
    // would resolve through whichever same-family row was indexed first instead of its own row.
    return (
      this.overrideByKey!.get(key) ??
      this.overrideByApiKey!.get(key) ??
      this.overrideByNormKey!.get(normKey) ??
      this.overrideByNormApiKey!.get(normKey) ??
      null
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
    this.providerModelsVersion = null
    this.modelById = null
    this.modelByNormId = null
    this.overrideByKey = null
    this.overrideByNormKey = null
    this.overrideByApiKey = null
    this.overrideByNormApiKey = null
    this.overridesByProvider = null
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
  }
}
