import type { ImageGenerationMode } from '@shared/data/types/model'
import type { PaintingMode } from '@shared/data/types/painting'

import { createNewApiProvider } from '../providers/newapi'
import { providerRegistry } from '../providers/registry'
import type { PaintingProviderDefinition } from '../providers/shared/provider'

const MODE_ALIASES: Record<string, string[]> = {
  generate: ['draw'],
  draw: ['generate']
}

export function resolvePaintingProviderDefinition(providerId: string): PaintingProviderDefinition {
  return providerRegistry[providerId] ?? createNewApiProvider(providerId)
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
