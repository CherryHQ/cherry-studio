import { uuid } from '@renderer/utils'
import type { PaintingMode } from '@shared/data/types/painting'

import type { PpioPaintingData } from '../../model/types/paintingData'
import { getModelsByMode, type PpioMode } from './models'

const DEFAULT_PPIO_PAINTING: PpioPaintingData = {
  id: '',
  providerId: 'ppio',
  mode: 'draw',
  files: [],
  model: 'jimeng-txt2img-v3.1',
  prompt: '',
  size: '1328x1328',
  ppioSeed: -1,
  usePreLlm: true,
  addWatermark: false,
  resolution: '4k',
  outputFormat: 'jpeg'
}

export function createDefaultPpioPainting(mode?: string): PpioPaintingData {
  const currentMode = (mode || 'ppio_draw') as PpioMode
  const models = getModelsByMode(currentMode)
  return {
    ...DEFAULT_PPIO_PAINTING,
    id: uuid(),
    mode: (currentMode === 'ppio_edit' ? 'edit' : 'draw') as PaintingMode,
    model: models[0]?.id || DEFAULT_PPIO_PAINTING.model
  }
}
