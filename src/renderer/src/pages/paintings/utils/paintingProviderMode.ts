import type { PaintingMode } from '@shared/data/types/painting'

import { createNewApiProvider } from '../providers/newapi'
import { providerRegistry } from '../providers/registry'
import type { PaintingProviderDefinition } from '../providers/shared/provider'

const MODE_ALIASES: Partial<Record<PaintingMode, PaintingMode[]>> = {
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
