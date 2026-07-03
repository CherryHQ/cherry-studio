import type { GeneratePainting } from '@renderer/types'
import { uuid } from '@renderer/utils'

export const SUPPORTED_MODELS = ['gpt-image-1', 'gpt-image-2']

const GPT_IMAGE_2_MIN_PIXELS = 655_360
const GPT_IMAGE_2_MAX_PIXELS = 8_294_400
const GPT_IMAGE_2_MAX_SIDE = 3840
const GPT_IMAGE_2_SIZE_STEP = 16
export const GPT_IMAGE_2_EXPERIMENTAL_PIXELS = 2560 * 1440

export const getNewApiBaseModelName = (modelId?: string) => modelId?.split('/').pop() ?? ''

export const getNewApiModelConfig = (modelId?: string) => {
  const baseModelName = getNewApiBaseModelName(modelId)
  return MODELS.find((model) => model.name === baseModelName)
}

export const isSupportedNewApiModel = (modelId?: string) => Boolean(getNewApiModelConfig(modelId))

export const normalizeGptImage2CustomDimension = (value?: number): number | undefined => {
  if (!value || !Number.isFinite(value)) {
    return undefined
  }

  const clampedValue = Math.min(Math.max(Math.round(value), GPT_IMAGE_2_SIZE_STEP), GPT_IMAGE_2_MAX_SIDE)
  return Math.round(clampedValue / GPT_IMAGE_2_SIZE_STEP) * GPT_IMAGE_2_SIZE_STEP
}

export const normalizeGptImage2CustomSize = (
  width?: number,
  height?: number,
  changedDimension: 'width' | 'height' = 'width'
): { width?: number; height?: number } => {
  const normalizedWidth = normalizeGptImage2CustomDimension(width)
  const normalizedHeight = normalizeGptImage2CustomDimension(height)

  if (!normalizedWidth || !normalizedHeight) {
    return { width: normalizedWidth, height: normalizedHeight }
  }

  let bestSize: { width: number; height: number } | undefined
  let bestScore = Number.POSITIVE_INFINITY

  for (
    let candidateWidth = GPT_IMAGE_2_SIZE_STEP;
    candidateWidth <= GPT_IMAGE_2_MAX_SIDE;
    candidateWidth += GPT_IMAGE_2_SIZE_STEP
  ) {
    for (
      let candidateHeight = GPT_IMAGE_2_SIZE_STEP;
      candidateHeight <= GPT_IMAGE_2_MAX_SIDE;
      candidateHeight += GPT_IMAGE_2_SIZE_STEP
    ) {
      if (validateGptImage2CustomSize(candidateWidth, candidateHeight)) {
        continue
      }

      const changedDimensionDelta =
        changedDimension === 'width'
          ? Math.abs(candidateWidth - normalizedWidth)
          : Math.abs(candidateHeight - normalizedHeight)
      const otherDimensionDelta =
        changedDimension === 'width'
          ? Math.abs(candidateHeight - normalizedHeight)
          : Math.abs(candidateWidth - normalizedWidth)
      const score = changedDimensionDelta * 10_000 + otherDimensionDelta

      if (score < bestScore) {
        bestScore = score
        bestSize = { width: candidateWidth, height: candidateHeight }
      }
    }
  }

  return bestSize ?? { width: normalizedWidth, height: normalizedHeight }
}

export const validateGptImage2CustomSize = (width?: number, height?: number): string | null => {
  if (!width || !height) {
    return 'paintings.gpt_image_custom_size_required'
  }

  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > GPT_IMAGE_2_MAX_SIDE ||
    height > GPT_IMAGE_2_MAX_SIDE
  ) {
    return 'paintings.gpt_image_custom_size_range'
  }

  if (width % GPT_IMAGE_2_SIZE_STEP !== 0 || height % GPT_IMAGE_2_SIZE_STEP !== 0) {
    return 'paintings.gpt_image_custom_size_divisible'
  }

  const ratio = width / height
  if (ratio < 1 / 3 || ratio > 3) {
    return 'paintings.gpt_image_custom_size_ratio'
  }

  const pixels = width * height
  if (pixels < GPT_IMAGE_2_MIN_PIXELS || pixels > GPT_IMAGE_2_MAX_PIXELS) {
    return 'paintings.gpt_image_custom_size_pixels'
  }

  return null
}

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
      { value: 'custom' }
    ],
    max_images: 10,
    quality: [{ value: 'auto' }, { value: 'high' }, { value: 'medium' }, { value: 'low' }],
    moderation: [{ value: 'auto' }, { value: 'low' }],
    output_compression_format: [{ value: 'jpeg' }, { value: 'webp' }],
    output_format: [{ value: 'image/png' }, { value: 'image/jpeg' }, { value: 'image/webp' }],
    background: [{ value: 'auto' }, { value: 'opaque' }]
  }
]

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
