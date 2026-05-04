import { uuid } from '@renderer/utils'
import type { PaintingMode } from '@shared/data/types/painting'

import { DEFAULT_PAINTING } from './config'

export type { AihubmixMode } from './config'
export { createModeConfigs, DEFAULT_PAINTING } from './config'

export function createDefaultAihubmixPainting(tab?: string) {
  const mode = (tab ?? 'generate') as PaintingMode
  return {
    ...DEFAULT_PAINTING,
    id: uuid(),
    mode,
    model: tab === 'generate' ? 'gemini-3-pro-image-preview' : 'V_3'
  }
}
