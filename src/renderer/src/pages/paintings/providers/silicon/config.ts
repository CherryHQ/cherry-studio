import ImageSize1_1 from '@renderer/assets/images/paintings/image-size-1-1.svg'
import ImageSize1_2 from '@renderer/assets/images/paintings/image-size-1-2.svg'
import ImageSize3_2 from '@renderer/assets/images/paintings/image-size-3-2.svg'
import ImageSize3_4 from '@renderer/assets/images/paintings/image-size-3-4.svg'
import ImageSize9_16 from '@renderer/assets/images/paintings/image-size-9-16.svg'
import ImageSize16_9 from '@renderer/assets/images/paintings/image-size-16-9.svg'
import type { Model, Painting } from '@renderer/types'
import { uuid } from '@renderer/utils'

export const TEXT_TO_IMAGES_MODELS: Model[] = [
  {
    id: 'Tongyi-MAI/Z-Image-Turbo',
    provider: 'silicon',
    name: 'Z-Image-Turbo',
    group: 'Tongyi-MAI'
  },
  {
    id: 'Tongyi-MAI/Z-Image',
    provider: 'silicon',
    name: 'Z-Image',
    group: 'Tongyi-MAI'
  },
  {
    id: 'baidu/ERNIE-Image-Turbo',
    provider: 'silicon',
    name: 'ERNIE-Image-Turbo',
    group: 'baidu'
  },
  {
    id: 'Qwen/Qwen-Image-Edit-2509',
    provider: 'silicon',
    name: 'Qwen-Image-Edit-2509',
    group: 'qwen'
  },
  {
    id: 'Qwen/Qwen-Image-Edit',
    provider: 'silicon',
    name: 'Qwen-Image-Edit',
    group: 'qwen'
  },
  {
    id: 'Kwai-Kolors/Kolors',
    provider: 'silicon',
    name: 'Kolors',
    group: 'Kwai-Kolors'
  },
  {
    id: 'Qwen/Qwen-Image',
    provider: 'silicon',
    name: 'Qwen-Image',
    group: 'qwen'
  }
]

const KOLORS_IMAGE_SIZES = [
  { label: '1:1', value: '1024x1024', icon: ImageSize1_1 },
  { label: '3:2', value: '1536x1024', icon: ImageSize3_2 },
  { label: '16:9', value: '2048x1152', icon: ImageSize16_9 },
  { label: '3:4', value: '1536x2048', icon: ImageSize3_4 },
  { label: '9:16', value: '1152x2048', icon: ImageSize9_16 },
  { label: '1:2', value: '1024x2048', icon: ImageSize1_2 }
]

const QWEN_IMAGE_SIZES = [
  { label: '1:1', value: '1328x1328', icon: ImageSize1_1 },
  { label: '3:2', value: '1584x1056', icon: ImageSize3_2 },
  { label: '16:9', value: '1664x928', icon: ImageSize16_9 },
  { label: '3:4', value: '1140x1472', icon: ImageSize3_4 },
  { label: '9:16', value: '928x1664', icon: ImageSize9_16 }
]

const Z_IMAGE_SIZES = [
  { label: '1:1', value: '1024x1024', icon: ImageSize1_1 },
  { label: '4:3', value: '1200x896', icon: ImageSize3_4 },
  { label: '3:2', value: '1264x848', icon: ImageSize3_2 },
  { label: '16:9', value: '1376x768', icon: ImageSize16_9 },
  { label: '3:4', value: '896x1200', icon: ImageSize3_4 },
  { label: '9:16', value: '768x1376', icon: ImageSize9_16 }
]

const SILICON_MODEL_PARAMS = {
  'Tongyi-MAI/Z-Image-Turbo': {
    imageSizes: Z_IMAGE_SIZES,
    supportsImageSize: true,
    supportsSteps: false,
    supportsGuidanceScale: false,
    supportsBatchSize: false,
    maxInputImages: 0,
    requiresInputImage: false
  },
  'Tongyi-MAI/Z-Image': {
    imageSizes: Z_IMAGE_SIZES,
    supportsImageSize: true,
    supportsSteps: true,
    supportsGuidanceScale: true,
    supportsBatchSize: false,
    maxInputImages: 0,
    requiresInputImage: false
  },
  'baidu/ERNIE-Image-Turbo': {
    imageSizes: Z_IMAGE_SIZES,
    supportsImageSize: true,
    supportsSteps: false,
    supportsGuidanceScale: true,
    supportsBatchSize: false,
    maxInputImages: 0,
    requiresInputImage: false
  },
  'Qwen/Qwen-Image-Edit-2509': {
    imageSizes: [],
    supportsImageSize: false,
    supportsSteps: true,
    supportsGuidanceScale: false,
    supportsBatchSize: false,
    maxInputImages: 3,
    requiresInputImage: true
  },
  'Qwen/Qwen-Image-Edit': {
    imageSizes: [],
    supportsImageSize: false,
    supportsSteps: true,
    supportsGuidanceScale: false,
    supportsBatchSize: false,
    maxInputImages: 1,
    requiresInputImage: true
  },
  'Qwen/Qwen-Image': {
    imageSizes: QWEN_IMAGE_SIZES,
    supportsImageSize: true,
    supportsSteps: true,
    supportsGuidanceScale: false,
    supportsBatchSize: false,
    maxInputImages: 0,
    requiresInputImage: false
  },
  'Kwai-Kolors/Kolors': {
    imageSizes: KOLORS_IMAGE_SIZES,
    supportsImageSize: true,
    supportsSteps: true,
    supportsGuidanceScale: true,
    supportsBatchSize: true,
    maxInputImages: 1,
    requiresInputImage: false
  }
}

export function getSiliconModelParams(model?: string) {
  return SILICON_MODEL_PARAMS[model as keyof typeof SILICON_MODEL_PARAMS] || SILICON_MODEL_PARAMS['Kwai-Kolors/Kolors']
}

export const generateRandomSeed = () => Math.floor(Math.random() * 1000000).toString()

export const DEFAULT_PAINTING: Painting = {
  id: uuid(),
  urls: [],
  files: [],
  prompt: '',
  negativePrompt: '',
  imageSize: '1024x1024',
  numImages: 1,
  seed: '',
  steps: 25,
  guidanceScale: 4.5,
  model: TEXT_TO_IMAGES_MODELS[0].id
}
