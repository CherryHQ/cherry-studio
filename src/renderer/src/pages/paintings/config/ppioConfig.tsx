import type { PpioPainting } from '@renderer/types'

// PPIO mode types
export type PpioMode = 'ppio_draw' | 'ppio_edit'

// Configuration item type definition
export type PpioConfigItem = {
  type: 'select' | 'slider' | 'input' | 'switch' | 'image' | 'textarea' | 'resolution'
  key?: keyof PpioPainting
  title?: string
  tooltip?: string
  options?: Array<{
    label: string
    value: string | number
    group?: string
  }>
  min?: number
  max?: number
  step?: number
  initialValue?: string | number | boolean
  required?: boolean
  condition?: (painting: PpioPainting) => boolean
}

// PPIO model definition
export interface PpioModel {
  id: string
  name: string
  endpoint: string
  group: string
  description?: string
  mode: PpioMode
  // Whether it's a synchronous API (returns result directly instead of task_id)
  isSync?: boolean
}

// All PPIO image generation models
export const PPIO_MODELS: PpioModel[] = [
  // ===== Draw mode (text-to-image) =====
  {
    id: 'jimeng-txt2img-v3.1',
    name: '即梦文生图 3.1',
    endpoint: '/v3/async/jimeng-txt2img-v3.1',
    group: '即梦',
    mode: 'ppio_draw',
    description: '画面效果升级，美感塑造、风格精准多样及画面细节丰富'
  },
  {
    id: 'jimeng-txt2img-v3.0',
    name: '即梦文生图 3.0',
    endpoint: '/v3/async/jimeng-txt2img-v3.0',
    group: '即梦',
    mode: 'ppio_draw',
    description: '文字响应准确度、图文排版、层次美感和语义理解能力显著提升'
  },
  {
    id: 'hunyuan-image-3',
    name: 'Hunyuan Image 3',
    endpoint: '/v3/async/hunyuan-image-3',
    group: '腾讯混元',
    mode: 'ppio_draw',
    description: '高质量、富有情感和故事性的图片生成'
  },
  {
    id: 'qwen-image-txt2img',
    name: 'Qwen-Image 文生图',
    endpoint: '/v3/async/qwen-image-txt2img',
    group: '通义千问',
    mode: 'ppio_draw',
    description: '擅长创建带有本地文本的图形海报'
  },
  {
    id: 'z-image-turbo',
    name: 'Z Image Turbo',
    endpoint: '/v3/async/z-image-turbo',
    group: 'Z Image',
    mode: 'ppio_draw',
    description: '高速图像生成模型'
  },
  {
    id: 'z-image-turbo-lora',
    name: 'Z Image Turbo LoRA',
    endpoint: '/v3/async/z-image-turbo-lora',
    group: 'Z Image',
    mode: 'ppio_draw',
    description: '支持自定义 LoRA 权重的高速图像生成'
  },
  {
    id: 'seedream-4.5-draw',
    name: 'Seedream 4.5',
    endpoint: '/v3/seedream-4.5',
    group: 'Seedream',
    mode: 'ppio_draw',
    isSync: true,
    description: '支持文生图、组图生成功能'
  },
  {
    id: 'seedream-4.0-draw',
    name: 'Seedream 4.0',
    endpoint: '/v3/seedream-4.0',
    group: 'Seedream',
    mode: 'ppio_draw',
    isSync: true,
    description: '支持4K分辨率的图像生成'
  },

  // ===== Edit mode (image editing) =====
  {
    id: 'seedream-4.5-edit',
    name: 'Seedream 4.5 图生图',
    endpoint: '/v3/seedream-4.5',
    group: 'Seedream',
    mode: 'ppio_edit',
    isSync: true,
    description: '基于参考图生成新图像'
  },
  {
    id: 'seedream-4.0-edit',
    name: 'Seedream 4.0 图生图',
    endpoint: '/v3/seedream-4.0',
    group: 'Seedream',
    mode: 'ppio_edit',
    isSync: true,
    description: '基于参考图生成新图像'
  },
  {
    id: 'qwen-image-edit',
    name: 'Qwen-Image 图像编辑',
    endpoint: '/v3/async/qwen-image-edit',
    group: '通义千问',
    mode: 'ppio_edit',
    description: '保留风格的精确图像编辑'
  },
  {
    id: 'image-upscaler',
    name: '图像高清化',
    endpoint: '/v3/async/image-upscaler',
    group: '图像工具',
    mode: 'ppio_edit',
    description: '将低分辨率图像提升到更高分辨率'
  },
  {
    id: 'image-remove-background',
    name: '图像背景移除',
    endpoint: '/v3/async/image-remove-background',
    group: '图像工具',
    mode: 'ppio_edit',
    description: '智能识别并移除图像背景'
  },
  {
    id: 'image-eraser',
    name: '图像擦除',
    endpoint: '/v3/async/image-eraser',
    group: '图像工具',
    mode: 'ppio_edit',
    description: '通过遮罩智能移除图像中的对象'
  }
]

// Get model list for specified mode
export const getModelsByMode = (mode: PpioMode): PpioModel[] => {
  return PPIO_MODELS.filter((m) => m.mode === mode)
}

// Get model configuration
export const getModelConfig = (modelId: string): PpioModel | undefined => {
  return PPIO_MODELS.find((m) => m.id === modelId)
}

// Sizes supported by Jimeng models
export const JIMENG_SIZE_OPTIONS = [
  { label: '1:1 (1328×1328)', value: '1328x1328' },
  { label: '4:3 (1472×1104)', value: '1472x1104' },
  { label: '3:2 (1584×1056)', value: '1584x1056' },
  { label: '16:9 (1664×936)', value: '1664x936' },
  { label: '21:9 (2016×864)', value: '2016x864' },
  { label: '2K (2048×2048)', value: '2048x2048' }
]

// Common size options
export const COMMON_SIZE_OPTIONS = [
  { label: '1024×1024', value: '1024x1024' },
  { label: '1024×1536', value: '1024x1536' },
  { label: '1536×1024', value: '1536x1024' },
  { label: '1536×1536', value: '1536x1536' },
  { label: '768×1024', value: '768x1024' },
  { label: '1024×768', value: '1024x768' }
]

// Seedream size options
export const SEEDREAM_SIZE_OPTIONS = [
  { label: '1K', value: '1K' },
  { label: '2K', value: '2K' },
  { label: '4K', value: '4K' },
  { label: '2048×2048', value: '2048x2048' },
  { label: '2304×1728 (4:3)', value: '2304x1728' },
  { label: '1728×2304 (3:4)', value: '1728x2304' },
  { label: '2560×1440 (16:9)', value: '2560x1440' },
  { label: '1440×2560 (9:16)', value: '1440x2560' }
]

// Image upscaling resolution options
export const UPSCALER_RESOLUTION_OPTIONS = [
  { label: '2K', value: '2k' },
  { label: '4K', value: '4k' },
  { label: '8K', value: '8k' }
]

// Output format options
export const OUTPUT_FORMAT_OPTIONS = [
  { label: 'JPEG', value: 'jpeg' },
  { label: 'PNG', value: 'png' },
  { label: 'WebP', value: 'webp' }
]

// Models that support seed
const MODELS_WITH_SEED = [
  'jimeng-txt2img-v3.1',
  'jimeng-txt2img-v3.0',
  'hunyuan-image-3',
  'z-image-turbo',
  'z-image-turbo-lora'
]

// Models that support watermark
const MODELS_WITH_WATERMARK = [
  'jimeng-txt2img-v3.1',
  'jimeng-txt2img-v3.0',
  'hunyuan-image-3',
  'qwen-image-txt2img',
  'seedream-4.5-draw',
  'seedream-4.0-draw'
]

// Draw mode configuration
export const createDrawModeConfig = (): PpioConfigItem[] => [
  {
    type: 'select',
    key: 'model',
    title: 'paintings.model',
    options: getModelsByMode('ppio_draw').map((m) => ({
      label: m.name,
      value: m.id,
      group: m.group
    }))
  },
  // Jimeng size options
  {
    type: 'select',
    key: 'size',
    title: 'paintings.image.size',
    options: JIMENG_SIZE_OPTIONS,
    condition: (painting) => painting.model?.startsWith('jimeng-') ?? false
  },
  // Common size options (Hunyuan, Qwen, Z Image)
  {
    type: 'select',
    key: 'size',
    title: 'paintings.image.size',
    options: COMMON_SIZE_OPTIONS,
    condition: (painting) =>
      ['hunyuan-image-3', 'qwen-image-txt2img', 'z-image-turbo', 'z-image-turbo-lora'].includes(painting.model || '')
  },
  // Seedream size options
  {
    type: 'select',
    key: 'size',
    title: 'paintings.image.size',
    options: SEEDREAM_SIZE_OPTIONS,
    condition: (painting) => painting.model?.includes('seedream-') ?? false
  },
  // seed - only supported by some models
  {
    type: 'input',
    key: 'ppioSeed',
    title: 'paintings.seed',
    tooltip: 'paintings.ppio.seed_tip',
    condition: (painting) => MODELS_WITH_SEED.includes(painting.model || '')
  },
  // use_pre_llm - only supported by Jimeng
  {
    type: 'switch',
    key: 'usePreLlm',
    title: 'paintings.prompt_enhancement',
    tooltip: 'paintings.ppio.use_pre_llm_tip',
    initialValue: true,
    condition: (painting) => painting.model?.startsWith('jimeng-') ?? false
  },
  // watermark - supported by some models
  {
    type: 'switch',
    key: 'addWatermark',
    title: 'paintings.watermark',
    tooltip: 'paintings.ppio.watermark_tip',
    initialValue: false,
    condition: (painting) => MODELS_WITH_WATERMARK.includes(painting.model || '')
  }
]

// Edit mode configuration
// Note: prompt uses the global input box at the bottom, not added separately in the left panel
export const createEditModeConfig = (): PpioConfigItem[] => [
  {
    type: 'select',
    key: 'model',
    title: 'paintings.model',
    options: getModelsByMode('ppio_edit').map((m) => ({
      label: m.name,
      value: m.id,
      group: m.group
    }))
  },
  {
    type: 'image',
    key: 'imageFile',
    title: 'paintings.edit.image_file',
    required: true
  },
  // mask image - only supported by image-eraser
  {
    type: 'image',
    key: 'ppioMask',
    title: 'paintings.ppio.mask_image',
    tooltip: 'paintings.ppio.mask_image_tip',
    required: false,
    condition: (painting) => painting.model === 'image-eraser'
  },
  // resolution - only supported by image-upscaler
  {
    type: 'select',
    key: 'resolution',
    title: 'paintings.ppio.resolution',
    options: UPSCALER_RESOLUTION_OPTIONS,
    initialValue: '4k',
    condition: (painting) => painting.model === 'image-upscaler'
  },
  // output_format - supported by image-upscaler, image-eraser, qwen-image-edit
  {
    type: 'select',
    key: 'outputFormat',
    title: 'paintings.ppio.output_format',
    options: OUTPUT_FORMAT_OPTIONS,
    initialValue: 'jpeg',
    condition: (painting) => ['image-upscaler', 'image-eraser', 'qwen-image-edit'].includes(painting.model || '')
  },
  // size - only supported by seedream
  {
    type: 'select',
    key: 'size',
    title: 'paintings.image.size',
    options: SEEDREAM_SIZE_OPTIONS,
    condition: (painting) => painting.model?.includes('seedream-') ?? false
  },
  // seed - only supported by qwen-image-edit
  {
    type: 'input',
    key: 'ppioSeed',
    title: 'paintings.seed',
    tooltip: 'paintings.ppio.seed_tip',
    condition: (painting) => painting.model === 'qwen-image-edit'
  },
  // watermark - supported by qwen-image-edit and seedream
  {
    type: 'switch',
    key: 'addWatermark',
    title: 'paintings.watermark',
    tooltip: 'paintings.ppio.watermark_tip',
    initialValue: false,
    condition: (painting) =>
      ['seedream-4.5-edit', 'seedream-4.0-edit', 'qwen-image-edit'].includes(painting.model || '')
  }
]

// Create mode configuration
export const createModeConfigs = (): Record<PpioMode, PpioConfigItem[]> => {
  return {
    ppio_draw: createDrawModeConfig(),
    ppio_edit: createEditModeConfig()
  }
}

// Default painting configuration
export const DEFAULT_PPIO_PAINTING: PpioPainting = {
  id: '',
  urls: [],
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
