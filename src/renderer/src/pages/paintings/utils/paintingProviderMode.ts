import type { ImageGenerationMode } from '@shared/data/types/model'
import type { PaintingMode } from '@shared/data/types/painting'

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
