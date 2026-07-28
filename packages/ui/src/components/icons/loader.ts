import type * as modelCatalogNs from './models/catalog'
import type { ModelIconKey } from './models/meta-catalog'
import type * as providerCatalogNs from './providers/catalog'
import type { ProviderIconKey } from './providers/meta-catalog'
import type { IconRef } from './registry'
import type { CompoundIcon } from './types'

/**
 * Async access to the generated component catalogs.
 *
 * The catalogs statically import every icon component (~4 MB of SVG paths),
 * so they must only ever be reached through the dynamic imports below — each
 * becomes its own async chunk, off every window's first paint. Loads are
 * cached and deduplicated by keeping the import promise; resolved modules are
 * additionally exposed synchronously so callers can skip a placeholder frame
 * once a catalog is in.
 */

type ProviderCatalogModule = typeof providerCatalogNs
type ModelCatalogModule = typeof modelCatalogNs

let providerCatalogModule: ProviderCatalogModule | undefined
let modelCatalogModule: ModelCatalogModule | undefined
let providerCatalogPromise: Promise<ProviderCatalogModule> | undefined
let modelCatalogPromise: Promise<ModelCatalogModule> | undefined

function loadProviderCatalogModule(): Promise<ProviderCatalogModule> {
  providerCatalogPromise ??= import('./providers/catalog').then((module) => {
    providerCatalogModule = module
    return module
  })
  return providerCatalogPromise
}

function loadModelCatalogModule(): Promise<ModelCatalogModule> {
  modelCatalogPromise ??= import('./models/catalog').then((module) => {
    modelCatalogModule = module
    return module
  })
  return modelCatalogPromise
}

export async function loadProviderIconCatalog(): Promise<Record<ProviderIconKey, CompoundIcon>> {
  return (await loadProviderCatalogModule()).PROVIDER_ICON_CATALOG
}

export async function loadProviderIcon(key: ProviderIconKey): Promise<CompoundIcon> {
  return (await loadProviderCatalogModule()).PROVIDER_ICON_CATALOG[key]
}

export async function loadModelIcon(key: ModelIconKey): Promise<CompoundIcon> {
  return (await loadModelCatalogModule()).MODEL_ICON_CATALOG[key]
}

export function loadIcon(ref: IconRef): Promise<CompoundIcon> {
  return ref.kind === 'provider' ? loadProviderIcon(ref.key) : loadModelIcon(ref.key)
}

/** Synchronous lookup that only hits once the matching catalog has loaded. */
export function getLoadedIcon(ref: IconRef): CompoundIcon | undefined {
  return ref.kind === 'provider'
    ? providerCatalogModule?.PROVIDER_ICON_CATALOG[ref.key]
    : modelCatalogModule?.MODEL_ICON_CATALOG[ref.key]
}
