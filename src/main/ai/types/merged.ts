/**
 * App-level provider type merge — combines `coreExtensions` with
 * Cherry's app extensions to produce the unified `AppProviderId`,
 * `AppProviderSettingsMap`, and `appProviderIds` lookup.
 */

import type { RuntimeConfig } from '@cherrystudio/ai-core/core'
import type {
  ExtensionConfigToIdResolutionMap,
  ExtensionToSettingsMap,
  ExtractProviderIds,
  StringKeys,
  UnionToIntersection
} from '@cherrystudio/ai-core/provider'
import { coreExtensions } from '@cherrystudio/ai-core/provider'

import { extensions } from '../provider/extensions'

const allExtensions = [...coreExtensions, ...extensions] as const

type AllExtensionConfigs = (typeof allExtensions)[number]['config']

type KnownAppProviderId = ExtractProviderIds<AllExtensionConfigs>

export type AppProviderId = KnownAppProviderId | (string & {})

export type AppProviderSettingsMap = UnionToIntersection<ExtensionToSettingsMap<(typeof allExtensions)[number]>>

export function isRegisteredProviderId(id: string): boolean {
  return allExtensions.some((ext) => ext.hasProviderId(id))
}

export function getAllProviderIds(): string[] {
  return allExtensions.flatMap((ext) => ext.getProviderIds())
}

type ProviderIdsMap = UnionToIntersection<ExtensionConfigToIdResolutionMap<AllExtensionConfigs>>

function buildAppProviderIds(): ProviderIdsMap {
  const map = new Map<string, string>()

  allExtensions.forEach((ext) => {
    const config = ext.config
    const name = config.name
    map.set(name, name)

    if ('aliases' in config && config.aliases) {
      config.aliases.forEach((alias) => {
        map.set(alias, name)
      })
    }

    if ('variants' in config && config.variants) {
      config.variants.forEach((variant) => {
        const variantId = `${name}-${variant.suffix}`
        map.set(variantId, variantId)
      })
    }
  })

  // SAFETY: Every declared name, alias and variant is populated with the resolution encoded by ProviderIdsMap.
  return Object.fromEntries(map) as ProviderIdsMap
}

export const appProviderIds = buildAppProviderIds()

export type AppRuntimeConfig<T extends StringKeys<AppProviderSettingsMap> = StringKeys<AppProviderSettingsMap>> =
  RuntimeConfig<AppProviderSettingsMap, T>
