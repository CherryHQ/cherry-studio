import type { GeneratePainting } from '@renderer/types'
import { uuid } from '@renderer/utils'

export const SUPPORTED_MODELS = ['gpt-image-1', 'gpt-image-2']

export const MODELS = [
  {
    name: 'gpt-image-1',
    group: 'OpenAI',
    imageSizes: [{ value: 'auto' }, { value: '1024x1024' }, { value: '1536x1024' }, { value: '1024x1536' }],
    max_images: 10,
    quality: [{ value: 'auto' }, { value: 'high' }, { value: 'medium' }, { value: 'low' }],
    moderation: [{ value: 'auto' }, { value: 'low' }],
    output_compression_format: [{ value: 'jpeg' }, { value: 'webp' }],
    output_format: [{ value: 'image/png' }, { value: 'image/jpeg' }, { value: 'image/webp' }],
    background: [{ value: 'auto' }, { value: 'transparent' }, { value: 'opaque' }]
  },
  {
    name: 'gpt-image-2',
    group: 'OpenAI',
    imageSizes: [
      { value: 'auto' },
      { value: '1024x1024' },
      { value: '1536x1024' },
      { value: '1024x1536' },
      { value: '2048x2048' },
      { value: '2560x1440' },
      { value: '1440x2560' }
    ],
    max_images: 10,
    quality: [{ value: 'auto' }, { value: 'high' }, { value: 'medium' }, { value: 'low' }],
    moderation: [{ value: 'auto' }, { value: 'low' }],
    output_compression_format: [{ value: 'jpeg' }, { value: 'webp' }],
    output_format: [{ value: 'image/png' }, { value: 'image/jpeg' }, { value: 'image/webp' }],
    background: [{ value: 'auto' }, { value: 'opaque' }]
  }
]

const isGptImage2FamilyModel = (modelName: string): boolean =>
  modelName === 'gpt-image-2' || modelName.startsWith('gpt-image-2-')

export const isSupportedNewApiModel = (modelName: string): boolean => {
  return SUPPORTED_MODELS.includes(modelName) || isGptImage2FamilyModel(modelName)
}

export const getNewApiModelConfig = (modelName?: string) => {
  const normalizedModelName = modelName && isGptImage2FamilyModel(modelName) ? 'gpt-image-2' : modelName

  return MODELS.find((m) => m.name === normalizedModelName) || MODELS[0]
}

export const DEFAULT_PAINTING: GeneratePainting = {
  id: uuid(),
  urls: [],
  files: [],
  model: '',
  prompt: '',
  quality: 'auto',
  n: 1,
  background: 'auto',
  moderation: 'auto',
  size: 'auto'
}
