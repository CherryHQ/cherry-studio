import type { PaintingMode } from '@shared/data/types/painting'

import { createNewApiProvider } from '../../providers/newapi'
import { providerRegistry } from '../../providers/registry'
import type { PaintingProvider } from '../../providers/shared/provider'

export function resolvePaintingProviderDefinition(providerId: string): PaintingProvider {
  return providerRegistry[providerId] ?? createNewApiProvider(providerId)
}

export function resolvePaintingTabForMode(definition: PaintingProvider, mode: PaintingMode): string | undefined {
  return definition.mode.tabs.find((item) => definition.mode.tabToDbMode(item.value) === mode)?.value
}
