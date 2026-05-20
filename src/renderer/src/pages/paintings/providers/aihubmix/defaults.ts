import { uuid } from '@renderer/utils'

import type { AihubmixPaintingData } from '../../model/types/paintingData'

const DEFAULT_PAINTING: AihubmixPaintingData = {
  id: 'aihubmix_1',
  providerId: 'aihubmix',
  mode: 'generate',
  model: 'gemini-3-pro-image-preview',
  aspectRatio: 'ASPECT_1_1',
  numImages: 1,
  styleType: 'AUTO',
  prompt: '',
  negativePrompt: '',
  magicPromptOption: true,
  seed: '',
  imageWeight: 50,
  resemblance: 50,
  detail: 50,
  imageFile: undefined,
  mask: undefined,
  files: [],
  renderingSpeed: 'DEFAULT',
  size: '1024x1024',
  background: 'auto',
  quality: 'auto',
  moderation: 'auto',
  n: 1,
  numberOfImages: 4,
  safetyTolerance: 6,
  imageSize: '1K'
}

export function createDefaultAihubmixPainting(tab?: string): AihubmixPaintingData {
  const mode = tab ?? 'generate'
  return {
    ...DEFAULT_PAINTING,
    id: uuid(),
    mode,
    model: tab === 'generate' ? 'gemini-3-pro-image-preview' : 'V_3'
  }
}
