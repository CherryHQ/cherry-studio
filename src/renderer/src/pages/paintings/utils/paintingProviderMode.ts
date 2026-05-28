import type { ImageGenerationMode } from '@shared/data/types/model'
import type { PaintingMode } from '@shared/data/types/painting'

import { buildPaintingProvider } from '../providers/buildPaintingProvider'
import type { PaintingProviderDefinition } from '../providers/types'

const MODE_ALIASES: Record<string, string[]> = {
  generate: ['draw'],
  draw: ['generate']
}

const providerCache = new Map<string, PaintingProviderDefinition>()

/**
 * Resolve a `PaintingProviderDefinition` for any provider id. Definitions
 * are generic — no per-provider hardcoded behavior — so any
 * `enabled provider × image-generation-capable model` combination works
 * without registry table maintenance.
 *
 * Caches per provider id so consumer `useMemo` deps see stable references
 * across renders.
 */
export function resolvePaintingProviderDefinition(providerId: string): PaintingProviderDefinition {
  const cached = providerCache.get(providerId)
  if (cached) return cached
  const built = buildPaintingProvider(providerId)
  providerCache.set(providerId, built)
  return built
}

export function resolvePaintingTabForMode(
  definition: PaintingProviderDefinition,
  mode: PaintingMode
): string | undefined {
  const exactTab = definition.mode.tabs.find((item) => definition.mode.tabToDbMode(item.value) === mode)
  if (exactTab) {
    return exactTab.value
  }

  const aliases = MODE_ALIASES[mode] ?? []
  return definition.mode.tabs.find((item) => aliases.includes(definition.mode.tabToDbMode(item.value)))?.value
}

/**
 * Bridge a vendor's `PaintingMode` to the canonical registry mode enum used
 * by `imageGenerationToFields(..., { mode })` for per-mode `modeSchemas`
 * resolution. `'draw'` aliases to `'generate'` (ppio's tab dbMode).
 */
export function tabToImageGenerationMode(dbMode: PaintingMode): ImageGenerationMode | undefined {
  if (dbMode === 'generate' || dbMode === 'draw') return 'generate'
  if (dbMode === 'edit') return 'edit'
  if (dbMode === 'remix') return 'remix'
  if (dbMode === 'upscale') return 'upscale'
  if (dbMode === 'merge') return 'merge'
  return undefined
}
