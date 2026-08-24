/**
 * Registry Loader — read, validate, cache, and query registry JSON data.
 *
 * Cached data auto-expires after an idle period (default 30s).
 * Any access resets the timer. When the timer fires, all data and indexes
 * are released — the next access triggers a fresh load from disk.
 */

import { readFileSync } from 'node:fs'

import semver from 'semver'
import * as z from 'zod'

import type { ModelConfig } from './schemas/model'
import { ModelListSchema } from './schemas/model'
import type { ProviderConfig } from './schemas/provider'
import { ProviderListSchema } from './schemas/provider'
import type { ProviderModelOverride } from './schemas/provider-models'
import { ProviderModelListSchema } from './schemas/provider-models'
import { colonVariantTagToHyphen, extractParameterSize, normalizeModelId } from './utils/normalize'

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
 * Oldest application version whose runtime understands the semantic values in
 * the current remote catalog. Bump when data starts using a new adapter family,
 * endpoint type, wire behavior, or other value that older runtime code cannot execute.
 */
export const REGISTRY_MIN_APP_VERSION = '2.0.9'

/**
 * The three JSON data files this package emits (`packages/provider-registry/data/`).
 * The canonical definition of what a full catalog consists of — consumed by the
 * app's loader-path resolution and by the remote updater's fetch loop.
 */
export const REGISTRY_FILES = ['models.json', 'providers.json', 'provider-models.json'] as const
export type RegistryFileName = (typeof REGISTRY_FILES)[number]

/** Unsigned branch data permitted to shadow the bundle. Provider routing stays bundled. */
export const REMOTE_REGISTRY_FILES = ['models.json', 'provider-models.json'] as const
export type RemoteRegistryFileName = (typeof REMOTE_REGISTRY_FILES)[number]

/**
 * Manifest published alongside each `v{N}/` catalog set (written last as the
 * completion marker). Consumed by the app's remote updater — to validate a
 * downloaded manifest and to gate a persisted override — so both parse against
 * this one schema instead of hand-rolled checks.
 */
export const CatalogManifestSchema = z.object({
  /** Oldest app whose runtime can interpret this catalog's semantic values. */
  minAppVersion: z.string().min(1),
  /** Latest released bundle this snapshot is known to be at least as new as. */
  sourceAppVersion: z.string().min(1),
  /** Monotonic workflow revision; clients never replace an active snapshot with an older/equal revision. */
  revision: z.number().int().nonnegative(),
  /** Schema version the set targets; must equal {@link REGISTRY_SCHEMA_VERSION} to be usable. */
  schemaVersion: z.number().int(),
  /** filename → content-hash `version`, binding the set to one published snapshot. */
  files: z.record(z.string(), z.string())
})
export type CatalogManifest = z.infer<typeof CatalogManifestSchema>

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
 * Who owns the canonical `provider::modelId` slot when several rows share it: the self variant
 * (`apiModelId === modelId`) first, then the untagged row (the paid tier next to a `free` sibling).
 * A tagged row never claims the slot, so the winner never depends on file order.
 */
const canonicalRank = (row?: ProviderModelOverride): number => {
  if (!row || row.modelVariants?.length) return -1
  return row.apiModelId === undefined || row.apiModelId === row.modelId ? 2 : 1
}

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
  private modelBySizedNorm: Map<string, ModelConfig> | null = null
  private overrideByKey: Map<string, ProviderModelOverride> | null = null
  private overrideByNormKey: Map<string, ProviderModelOverride> | null = null
  private overrideBySizedNormKey: Map<string, ProviderModelOverride> | null = null
  private overrideByApiKey: Map<string, ProviderModelOverride> | null = null
  private overrideByNormApiKey: Map<string, ProviderModelOverride> | null = null
  private overrideBySizedNormApiKey: Map<string, ProviderModelOverride> | null = null
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
    this.modelBySizedNorm = new Map()
    for (const m of this.models!) {
      this.modelById.set(m.id, m)
      const nid = normalizeModelId(m.id)
      if (!this.modelByNormId.has(nid)) {
        this.modelByNormId.set(nid, m)
      }
      // Size-preserving key: `gpt-oss-20b` and `gpt-oss-120b` stay distinct here (they collapse to the
      // same `gpt-oss` key above), so a registry-tagged `:20b`/`:120b` pull resolves to its own row.
      const sid = normalizeModelId(m.id, { keepParameterSize: true })
      if (!this.modelBySizedNorm.has(sid)) {
        this.modelBySizedNorm.set(sid, m)
      }
    }
  }

  private buildOverrideIndex(): void {
    this.overrideByKey = new Map()
    this.overrideByNormKey = new Map()
    this.overrideBySizedNormKey = new Map()
    this.overrideByApiKey = new Map()
    this.overrideByNormApiKey = new Map()
    this.overrideBySizedNormApiKey = new Map()
    this.overridesByProvider = new Map()
    for (const pm of this.providerModels!) {
      const key = `${pm.providerId}::${pm.modelId}`
      // `modelId` is NOT unique: a provider may serve one canonical model under several apiModelIds
      // (tokenhub's dated 原厂直供 variants share `deepseek-v4-flash`; cherryin's free tier shares
      // `deepseek-v3-2` with the paid row). The canonical key must resolve to the default variant —
      // the others stay reachable only via the apiModelId index below. Order-independent by rank.
      if (canonicalRank(pm) > canonicalRank(this.overrideByKey.get(key))) {
        this.overrideByKey.set(key, pm)
      }
      // Same rank rule as the exact key: without it this map alone stays first-wins, so a free twin
      // authored before its paid row would quietly own the normalized canonical slot.
      const normKey = `${pm.providerId}::${normalizeModelId(pm.modelId)}`
      if (canonicalRank(pm) > canonicalRank(this.overrideByNormKey.get(normKey))) {
        this.overrideByNormKey.set(normKey, pm)
      }
      // Size-preserving normalized key (mirror of `modelBySizedNorm`). Size siblings collapse to one
      // size-agnostic key (`gpt-oss-20b`/`gpt-oss-120b` both → `gpt-oss`), so a fetch id that misses the
      // exact keys — a gateway re-namespacing a model (`nvidia/gpt-oss-20b`) — must resolve to its OWN
      // size's row, never the first sibling to claim the family key. Same rank rule as the exact key so
      // neither a dated nor a variant-tagged row claims the sized slot.
      const sizedNormKey = `${pm.providerId}::${normalizeModelId(pm.modelId, { keepParameterSize: true })}`
      if (canonicalRank(pm) > canonicalRank(this.overrideBySizedNormKey.get(sizedNormKey))) {
        this.overrideBySizedNormKey.set(sizedNormKey, pm)
      }
      if (pm.apiModelId) {
        const apiKey = `${pm.providerId}::${pm.apiModelId}`
        this.overrideByApiKey.set(apiKey, pm)
        // Normalization erases the variant tag (`…v3.2(free)` → `deepseek-v3-2`), so a tagged row would
        // otherwise be free to claim the fallback slot and bill a paid alias at the free tier.
        const normApiKey = `${pm.providerId}::${normalizeModelId(pm.apiModelId)}`
        if (canonicalRank(pm) > canonicalRank(this.overrideByNormApiKey.get(normApiKey))) {
          this.overrideByNormApiKey.set(normApiKey, pm)
        }
        const sizedNormApiKey = `${pm.providerId}::${normalizeModelId(pm.apiModelId, { keepParameterSize: true })}`
        if (canonicalRank(pm) > canonicalRank(this.overrideBySizedNormApiKey.get(sizedNormApiKey))) {
          this.overrideBySizedNormApiKey.set(sizedNormApiKey, pm)
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
    const exact = this.modelById!.get(modelId)
    if (exact) return exact
    // A registry-tag id (`gpt-oss:20b`) carries its size/quant AFTER a colon. Match it size-first so
    // `:20b` lands on `gpt-oss-20b`, never collapsing onto the `gpt-oss-120b` sibling that shares the
    // size-agnostic key. If no exact-size catalog row exists (`qwen2.5:7b` → the catalog only has
    // `qwen2-5-*-instruct`), return null rather than a size-agnostic guess — a wrong sibling's pricing,
    // limits, and presetModelId are worse than no metadata.
    if (colonVariantTagToHyphen(modelId) !== modelId) {
      return this.modelBySizedNorm!.get(normalizeModelId(modelId, { keepParameterSize: true })) ?? null
    }
    // Prefer the size-preserving key before the family key so distinct catalog sizes keep their metadata.
    const sizedModelId = normalizeModelId(modelId, { keepParameterSize: true })
    const sizedHit = this.modelBySizedNorm!.get(sizedModelId)
    if (sizedHit) return sizedHit
    if (extractParameterSize(sizedModelId)) return null
    return this.modelByNormId!.get(normalizeModelId(modelId)) ?? null
  }

  findProvider(providerId: string): ProviderConfig | null {
    const providers = this.loadProviders()
    return providers.find((p) => p.id === providerId) ?? null
  }

  findOverride(providerId: string, modelId: string): ProviderModelOverride | null {
    this.loadProviderModels()
    const key = `${providerId}::${modelId}`
    // BOTH exact lookups (canonical modelId, then provider apiModelId) must precede BOTH normalized
    // fallbacks. `normalizeModelId` strips size/date suffixes, so several distinct rows collapse to one
    // normalized key (`google.gemma-3-27b-it` and `gemma-3-12b-it` both → `gemma-3-it`). If the normalized
    // canonical fallback ran before the exact apiModelId map, an exact SDK id like `google.gemma-3-27b-it`
    // would resolve through whichever same-family row was indexed first instead of its own row.
    const exact = this.overrideByKey!.get(key) ?? this.overrideByApiKey!.get(key)
    if (exact) return exact

    const sizedModelId = normalizeModelId(modelId, { keepParameterSize: true })
    const sizedNormKey = `${providerId}::${sizedModelId}`
    const sizedHit = this.overrideBySizedNormKey!.get(sizedNormKey) ?? this.overrideBySizedNormApiKey!.get(sizedNormKey)
    if (sizedHit) return sizedHit
    if (extractParameterSize(sizedModelId)) return null

    const normKey = `${providerId}::${normalizeModelId(modelId)}`
    return this.overrideByNormKey!.get(normKey) ?? this.overrideByNormApiKey!.get(normKey) ?? null
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
    this.modelBySizedNorm = null
    this.overrideByKey = null
    this.overrideByNormKey = null
    this.overrideBySizedNormKey = null
    this.overrideByApiKey = null
    this.overrideByNormApiKey = null
    this.overrideBySizedNormApiKey = null
    this.overridesByProvider = null
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
  }
}
