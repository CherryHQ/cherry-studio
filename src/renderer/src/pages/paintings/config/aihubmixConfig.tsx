import type { PaintingAction } from '@renderer/types'

import {
  ASPECT_RATIOS,
  BACKGROUND_OPTIONS,
  MODERATION_OPTIONS,
  PERSON_GENERATION_OPTIONS,
  QUALITY_OPTIONS,
  RENDERING_SPEED_OPTIONS,
  STYLE_TYPES,
  V3_STYLE_TYPES
} from './constants'

// 配置项类型定义
export type ConfigItem = {
  type:
    | 'select'
    | 'radio'
    | 'slider'
    | 'input'
    | 'switch'
    | 'inputNumber'
    | 'textarea'
    | 'title'
    | 'description'
    | 'image'
  key?: keyof PaintingAction | 'commonModel'
  title?: string
  tooltip?: string
  options?:
    | Array<{
        label: string
        title?: string
        value?: string | number
        icon?: string
        onlyV2?: boolean
        options?: Array<{ label: string; value: string | number; icon?: string; onlyV2?: boolean }>
      }>
    | ((
        config: ConfigItem,
        painting: Partial<PaintingAction>
      ) => Array<{ label: string; value: string | number; icon?: string; onlyV2?: boolean }>)
  min?: number
  max?: number
  step?: number
  suffix?: React.ReactNode
  content?: string
  disabled?: boolean | ((config: ConfigItem, painting: Partial<PaintingAction>) => boolean)
  initialValue?: string | number
  required?: boolean
  condition?: (painting: PaintingAction) => boolean
}

export type AihubmixMode = 'generate' | 'remix' | 'upscale'

// 创建配置项函数
export const createModeConfigs = (): Record<AihubmixMode, ConfigItem[]> => {
  return {
    generate: [
      {
        type: 'select',
        key: 'model',
        title: 'paintings.model',
        tooltip: 'paintings.generate.model_tip',
        options: [
          {
            label: 'OpenAI',
            title: 'OpenAI',
            options: [{ label: 'gpt-image-1', value: 'gpt-image-1' }]
          },
          {
            label: 'Gemini',
            title: 'Gemini',
            options: [
              { label: 'imagen-4.0-preview', value: 'imagen-4.0-generate-preview-06-06' },
              { label: 'imagen-4.0-ultra', value: 'imagen-4.0-ultra-generate-preview-06-06' }
            ]
          },
          {
            label: 'ideogram',
            title: 'ideogram',
            options: [
              { label: 'ideogram_V_3', value: 'V_3' },
              { label: 'ideogram_V_2', value: 'V_2' },
              { label: 'ideogram_V_2_TURBO', value: 'V_2_TURBO' },
              { label: 'ideogram_V_2A', value: 'V_2A' },
              { label: 'ideogram_V_2A_TURBO', value: 'V_2A_TURBO' },
              { label: 'ideogram_V_1', value: 'V_1' },
              { label: 'ideogram_V_1_TURBO', value: 'V_1_TURBO' }
            ]
          }
        ]
      },
      {
        type: 'select',
        key: 'renderingSpeed',
        title: 'paintings.rendering_speed',
        tooltip: 'paintings.generate.rendering_speed_tip',
        options: RENDERING_SPEED_OPTIONS,
        initialValue: 'DEFAULT',
        condition: (painting) => painting.model === 'V_3'
      },
      {
        type: 'select',
        key: 'aspectRatio',
        title: 'paintings.aspect_ratio',
        options: ASPECT_RATIOS,
        condition: (painting) => Boolean(painting.model?.startsWith('V_'))
      },
      {
        type: 'slider',
        key: 'numImages',
        title: 'paintings.number_images',
        tooltip: 'paintings.generate.number_images_tip',
        min: 1,
        max: 8,
        condition: (painting) => Boolean(painting.model?.startsWith('V_'))
      },
      {
        type: 'select',
        key: 'styleType',
        title: 'paintings.style_type',
        tooltip: 'paintings.generate.style_type_tip',
        options: (_config, painting) => {
          // 根据模型选择显示不同的样式类型选项
          return painting?.model?.includes('V_3') ? V3_STYLE_TYPES : STYLE_TYPES
        },
        disabled: false,
        condition: (painting) => Boolean(painting.model?.startsWith('V_'))
      },
      {
        type: 'input',
        key: 'seed',
        title: 'paintings.seed',
        tooltip: 'paintings.generate.seed_tip',
        condition: (painting) => Boolean(painting.model?.startsWith('V_'))
      },
      {
        type: 'textarea',
        key: 'negativePrompt',
        title: 'paintings.negative_prompt',
        tooltip: 'paintings.generate.negative_prompt_tip',
        condition: (painting) => Boolean(painting.model?.startsWith('V_'))
      },
      {
        type: 'switch',
        key: 'magicPromptOption',
        title: 'paintings.magic_prompt_option',
        tooltip: 'paintings.generate.magic_prompt_option_tip',
        condition: (painting) => Boolean(painting.model?.startsWith('V_'))
      },
      {
        type: 'select',
        key: 'size',
        title: 'paintings.aspect_ratio',
        options: [
          { label: '自动', value: 'auto' },
          { label: '1:1', value: '1024x1024' },
          { label: '3:2', value: '1536x1024' },
          { label: '2:3', value: '1024x1536' }
        ],
        initialValue: '1024x1024',
        condition: (painting) => painting.model === 'gpt-image-1'
      },
      {
        type: 'slider',
        key: 'n',
        title: 'paintings.number_images',
        tooltip: 'paintings.generate.number_images_tip',
        min: 1,
        max: 10,
        initialValue: 1,
        condition: (painting) => painting.model === 'gpt-image-1'
      },
      {
        type: 'select',
        key: 'quality',
        title: 'paintings.quality',
        options: QUALITY_OPTIONS,
        initialValue: 'auto',
        condition: (painting) => painting.model === 'gpt-image-1'
      },
      {
        type: 'select',
        key: 'moderation',
        title: 'paintings.moderation',
        options: MODERATION_OPTIONS,
        initialValue: 'auto',
        condition: (painting) => painting.model === 'gpt-image-1'
      },
      {
        type: 'select',
        key: 'background',
        title: 'paintings.background',
        options: BACKGROUND_OPTIONS,
        initialValue: 'auto',
        condition: (painting) => painting.model === 'gpt-image-1'
      },
      {
        type: 'slider',
        key: 'numberOfImages',
        title: 'paintings.number_images',
        tooltip: 'paintings.generate.number_images_tip',
        min: 1,
        max: 4,
        initialValue: 4,
        condition: (painting) =>
          Boolean(painting.model?.startsWith('imagen-') && painting.model !== 'imagen-4.0-ultra-generate-preview-06-06')
      },
      {
        type: 'select',
        key: 'aspectRatio',
        title: 'paintings.aspect_ratio',
        options: [
          { label: '1:1', value: 'ASPECT_1_1' },
          { label: '3:4', value: 'ASPECT_3_4' },
          { label: '4:3', value: 'ASPECT_4_3' },
          { label: '9:16', value: 'ASPECT_9_16' },
          { label: '16:9', value: 'ASPECT_16_9' }
        ],
        initialValue: 'ASPECT_1_1',
        condition: (painting) => Boolean(painting.model?.startsWith('imagen-'))
      },
      {
        type: 'select',
        key: 'personGeneration',
        title: 'paintings.generate.person_generation',
        tooltip: 'paintings.generate.person_generation_tip',
        options: PERSON_GENERATION_OPTIONS,
        initialValue: 'ALLOW_ALL',
        condition: (painting) => Boolean(painting.model?.startsWith('imagen-'))
      }
    ],
    remix: [
      {
        type: 'image',
        key: 'imageFile',
        title: 'paintings.remix.image_file'
      },
      {
        type: 'select',
        key: 'model',
        title: 'paintings.model',
        tooltip: 'paintings.remix.model_tip',
        options: [
          { label: 'ideogram_V_3', value: 'V_3' },
          { label: 'ideogram_V_2', value: 'V_2' },
          { label: 'ideogram_V_2_TURBO', value: 'V_2_TURBO' },
          { label: 'ideogram_V_2A', value: 'V_2A' },
          { label: 'ideogram_V_2A_TURBO', value: 'V_2A_TURBO' },
          { label: 'ideogram_V_1', value: 'V_1' },
          { label: 'ideogram_V_1_TURBO', value: 'V_1_TURBO' }
        ]
      },
      {
        type: 'select',
        key: 'renderingSpeed',
        title: 'paintings.rendering_speed',
        options: RENDERING_SPEED_OPTIONS,
        initialValue: 'DEFAULT',
        disabled: (_config, painting) => {
          const model = painting?.model
          return !model || !model.includes('V_3')
        }
      },
      {
        type: 'select',
        key: 'aspectRatio',
        title: 'paintings.aspect_ratio',
        options: ASPECT_RATIOS
      },
      {
        type: 'slider',
        key: 'imageWeight',
        title: 'paintings.remix.image_weight',
        min: 1,
        max: 100
      },
      {
        type: 'slider',
        key: 'numImages',
        title: 'paintings.number_images',
        tooltip: 'paintings.remix.number_images_tip',
        min: 1,
        max: 8
      },
      {
        type: 'select',
        key: 'styleType',
        title: 'paintings.style_type',
        tooltip: 'paintings.remix.style_type_tip',
        options: (_config, painting) => {
          // 根据模型选择显示不同的样式类型选项
          return painting?.model?.includes('V_3') ? V3_STYLE_TYPES : STYLE_TYPES
        },
        disabled: false
      },
      {
        type: 'input',
        key: 'seed',
        title: 'paintings.seed',
        tooltip: 'paintings.remix.seed_tip'
      },
      {
        type: 'textarea',
        key: 'negativePrompt',
        title: 'paintings.negative_prompt',
        tooltip: 'paintings.remix.negative_prompt_tip'
      },
      {
        type: 'switch',
        key: 'magicPromptOption',
        title: 'paintings.magic_prompt_option',
        tooltip: 'paintings.remix.magic_prompt_option_tip'
      }
    ],
    upscale: [
      {
        type: 'image',
        key: 'imageFile',
        title: 'paintings.upscale.image_file',
        required: true
      },
      {
        type: 'slider',
        key: 'resemblance',
        title: 'paintings.upscale.resemblance',
        min: 1,
        max: 100
      },
      {
        type: 'slider',
        key: 'detail',
        title: 'paintings.upscale.detail',
        tooltip: 'paintings.upscale.detail_tip',
        min: 1,
        max: 100
      },
      {
        type: 'slider',
        key: 'numImages',
        title: 'paintings.number_images',
        tooltip: 'paintings.upscale.number_images_tip',
        min: 1,
        max: 8
      },
      {
        type: 'input',
        key: 'seed',
        title: 'paintings.seed',
        tooltip: 'paintings.upscale.seed_tip'
      },
      {
        type: 'switch',
        key: 'magicPromptOption',
        title: 'paintings.magic_prompt_option',
        tooltip: 'paintings.upscale.magic_prompt_option_tip'
      }
    ]
  }
}

// 几种默认的绘画配置
export const DEFAULT_PAINTING: PaintingAction = {
  id: 'aihubmix_1',
  model: 'gpt-image-1',
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
  urls: [],
  renderingSpeed: 'DEFAULT',
  size: '1024x1024',
  background: 'auto',
  quality: 'auto',
  moderation: 'auto',
  n: 1,
  numberOfImages: 4
}
