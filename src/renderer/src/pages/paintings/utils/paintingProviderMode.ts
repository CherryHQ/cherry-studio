import type { ImageGenerationMode } from '@shared/data/types/model'
import type { PaintingMode } from '@shared/data/types/painting'

import { buildPaintingProvider } from '../providers/buildPaintingProvider'
import type { PaintingProviderDefinition } from '../providers/types'

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

/**
 * Painting modes that resolve to the single 'default' tab every painting
 * provider exposes. The painting page is single-tab post-unification —
 * 'draw' is a legacy alias for 'generate' (PPIO's old tab dbMode).
 */
const SUPPORTED_DB_MODES = new Set<PaintingMode>(['generate', 'draw', 'edit', 'remix', 'upscale', 'merge'])

export function resolvePaintingTabForMode(
  _definition: PaintingProviderDefinition,
  mode: PaintingMode
): string | undefined {
  return SUPPORTED_DB_MODES.has(mode) ? 'default' : undefined
}

/**
 * Bridge `PaintingMode` (the dbMode stored on PaintingData) to the canonical
 * registry mode used by `imageGenerationToFields(..., { mode })`. 'draw'
 * aliases to 'generate' for legacy PPIO paintings.
 */
export function tabToImageGenerationMode(dbMode: PaintingMode): ImageGenerationMode | undefined {
  if (dbMode === 'generate' || dbMode === 'draw') return 'generate'
  if (dbMode === 'edit') return 'edit'
  if (dbMode === 'remix') return 'remix'
  if (dbMode === 'upscale') return 'upscale'
  if (dbMode === 'merge') return 'merge'
  return undefined
}
