import { uuid } from '@renderer/utils'

import { DEFAULT_PAINTING } from './config'

export type { AihubmixMode } from './config'
export { createModeConfigs, DEFAULT_PAINTING } from './config'

export function createDefaultAihubmixPainting(mode?: string) {
  return {
    ...DEFAULT_PAINTING,
    model: mode === 'generate' ? 'gemini-3-pro-image-preview' : 'V_3',
    id: uuid()
  }
}
