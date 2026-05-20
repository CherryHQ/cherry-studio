// PPIO transport routing table. Each entry maps a model id to its API
// endpoint, group label, mode (draw/edit), and sync/async behavior.
// Stays in code (not the provider registry) because this is transport
// knowledge — not user-facing field metadata, which lives in the
// registry's per-model `imageGeneration` block.

export type PpioMode = 'ppio_draw' | 'ppio_edit'

export interface PpioModel {
  id: string
  name: string
  endpoint: string
  group: string
  description?: string
  mode: PpioMode
  /** Direct response (no task_id polling) when true. */
  isSync?: boolean
}

export const PPIO_MODELS: PpioModel[] = [
  // ===== Draw 模式 (文生图) =====
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

  // ===== Edit 模式 (图像编辑) =====
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

export function getModelsByMode(mode: PpioMode): PpioModel[] {
  return PPIO_MODELS.filter((m) => m.mode === mode)
}

export function getModelConfig(modelId: string): PpioModel | undefined {
  return PPIO_MODELS.find((m) => m.id === modelId)
}
