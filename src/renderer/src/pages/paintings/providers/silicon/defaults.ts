import ImageSize1_1 from '@renderer/assets/images/paintings/image-size-1-1.svg'
import ImageSize1_2 from '@renderer/assets/images/paintings/image-size-1-2.svg'
import ImageSize3_2 from '@renderer/assets/images/paintings/image-size-3-2.svg'
import ImageSize3_4 from '@renderer/assets/images/paintings/image-size-3-4.svg'
import ImageSize9_16 from '@renderer/assets/images/paintings/image-size-9-16.svg'
import ImageSize16_9 from '@renderer/assets/images/paintings/image-size-16-9.svg'
import { uuid } from '@renderer/utils'

import type { ModelOption } from '../../model/types/paintingModel'

export const SILICON_IMAGE_SIZES = [
  { label: '1:1', value: '1024x1024', icon: ImageSize1_1 },
  { label: '1:2', value: '512x1024', icon: ImageSize1_2 },
  { label: '3:2', value: '768x512', icon: ImageSize3_2 },
  { label: '3:4', value: '768x1024', icon: ImageSize3_4 },
  { label: '16:9', value: '1024x576', icon: ImageSize16_9 },
  { label: '9:16', value: '576x1024', icon: ImageSize9_16 }
]

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
