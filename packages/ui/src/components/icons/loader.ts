import type * as modelLoadersNs from './models/loaders'
import type { ModelIconKey } from './models/meta-catalog'
import type * as providerCatalogNs from './providers/catalog'
import type * as providerLoadersNs from './providers/loaders'
import type { ProviderIconKey } from './providers/meta-catalog'
import type { IconRef } from './registry'
import type { CompoundIcon } from './types'

/**
 * Async access to generated icon implementations.
 *
 * Ordinary lookups load one icon module by key. The provider bulk catalog stays
 * available for ProviderLogoPicker, which intentionally renders every provider.
 * Per-icon loads are cached and deduplicated for the lifetime of one renderer.
 */

type ProviderCatalogModule = typeof providerCatalogNs
type ProviderLoadersModule = typeof providerLoadersNs
type ModelLoadersModule = typeof modelLoadersNs

let providerCatalogModule: ProviderCatalogModule | undefined
let providerCatalogPromise: Promise<ProviderCatalogModule> | undefined
let providerLoadersPromise: Promise<ProviderLoadersModule> | undefined
let modelLoadersPromise: Promise<ModelLoadersModule> | undefined

const loadedIcons = new Map<string, CompoundIcon>()
const iconPromises = new Map<string, Promise<CompoundIcon>>()

function iconCacheKey(kind: IconRef['kind'], key: string): string {
  return `${kind}:${key}`
}

function loadCachedIcon(cacheKey: string, load: () => Promise<CompoundIcon>): Promise<CompoundIcon> {
  const loaded = loadedIcons.get(cacheKey)
  if (loaded) return Promise.resolve(loaded)

  const pending = iconPromises.get(cacheKey)
  if (pending) return pending

  const promise = load().then(
    (icon) => {
      loadedIcons.set(cacheKey, icon)
      iconPromises.delete(cacheKey)
      return icon
    },
    (error) => {
      iconPromises.delete(cacheKey)
      throw error
    }
  )
  iconPromises.set(cacheKey, promise)
  return promise
}

function loadProviderCatalogModule(): Promise<ProviderCatalogModule> {
  if (providerCatalogPromise) return providerCatalogPromise

  const promise = import('./providers/catalog')
    .then((module) => {
      providerCatalogModule = module
      for (const [key, icon] of Object.entries(module.PROVIDER_ICON_CATALOG)) {
        loadedIcons.set(iconCacheKey('provider', key), icon)
      }
      return module
    })
    .catch((error) => {
      providerCatalogPromise = undefined
      throw error
    })
  providerCatalogPromise = promise
  return promise
}

function loadProviderLoadersModule(): Promise<ProviderLoadersModule> {
  providerLoadersPromise ??= import('./providers/loaders')
  return providerLoadersPromise
}

function loadModelLoadersModule(): Promise<ModelLoadersModule> {
  modelLoadersPromise ??= import('./models/loaders')
  return modelLoadersPromise
}

export async function loadProviderIconCatalog(): Promise<Record<ProviderIconKey, CompoundIcon>> {
  return (await loadProviderCatalogModule()).PROVIDER_ICON_CATALOG
}

export async function loadProviderIcon(key: ProviderIconKey): Promise<CompoundIcon> {
  const cacheKey = iconCacheKey('provider', key)
  return loadCachedIcon(cacheKey, async () => {
    if (providerCatalogModule) {
      return providerCatalogModule.PROVIDER_ICON_CATALOG[key]
    }
    const loaders = await loadProviderLoadersModule()
    return loaders.PROVIDER_ICON_LOADERS[key]()
  })
}

export async function loadModelIcon(key: ModelIconKey): Promise<CompoundIcon> {
  const cacheKey = iconCacheKey('model', key)
  return loadCachedIcon(cacheKey, async () => {
    const loaders = await loadModelLoadersModule()
    return loaders.MODEL_ICON_LOADERS[key]()
  })
}

export function loadIcon(ref: IconRef): Promise<CompoundIcon> {
  return ref.kind === 'provider' ? loadProviderIcon(ref.key) : loadModelIcon(ref.key)
}

/** Synchronous lookup that only hits once the matching icon has loaded. */
export function getLoadedIcon(ref: IconRef): CompoundIcon | undefined {
  if (ref.kind === 'provider' && providerCatalogModule) {
    return providerCatalogModule.PROVIDER_ICON_CATALOG[ref.key]
  }
  return loadedIcons.get(iconCacheKey(ref.kind, ref.key))
}
