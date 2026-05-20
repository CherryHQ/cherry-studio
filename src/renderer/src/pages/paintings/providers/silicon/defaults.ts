import { uuid } from '@renderer/utils'

import type { ModelOption } from '../../model/types/paintingModel'

export const generateSiliconRandomSeed = () => Math.floor(Math.random() * 1000000).toString()

export function createDefaultSiliconPainting(modelOptions?: ModelOption[]) {
  return {
    id: uuid(),
    providerId: 'silicon' as const,
    mode: 'generate' as const,
    files: [],
    prompt: '',
    negativePrompt: '',
    imageSize: '1024x1024',
    numImages: 1,
    seed: generateSiliconRandomSeed(),
    steps: 25,
    guidanceScale: 4.5,
    model: modelOptions?.[0]?.value ?? ''
  }
}
