import { uuid } from '@renderer/utils'
import type { PaintingMode } from '@shared/data/types/painting'

import type { PpioMode } from './config'
import { DEFAULT_PPIO_PAINTING, getModelsByMode } from './config'

export type { PpioMode } from './config'
export { createModeConfigs, DEFAULT_PPIO_PAINTING, getModelsByMode } from './config'

export function createDefaultPpioPainting(mode?: string) {
  const currentMode = (mode || 'ppio_draw') as PpioMode
  const models = getModelsByMode(currentMode)
  return {
    ...DEFAULT_PPIO_PAINTING,
    id: uuid(),
    mode: (currentMode === 'ppio_edit' ? 'edit' : 'draw') as PaintingMode,
    model: models[0]?.id || DEFAULT_PPIO_PAINTING.model
  }
}
