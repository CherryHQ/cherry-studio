import type { PaintingAction, PaintingsState } from '@renderer/types'

import { ASPECT_RATIOS, RENDERING_SPEED_OPTIONS, STYLE_TYPES, V3_STYLE_TYPES } from './constants'

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
    | Array<{ label: string; value: string | number; icon?: string; onlyV2?: boolean }>
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
}

export type AihubmixMode = keyof PaintingsState

// 创建配置项函数
export const createModeConfigs = (): Record<AihubmixMode, ConfigItem[]> => {
  return {
    paintings: [],
    DMXAPIPaintings: [],
    generate: [
      { type: 'title', title: 'paintings.model', tooltip: 'paintings.generate.model_tip' },
      {
        type: 'select',
        key: 'model',
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
      { type: 'title', title: 'paintings.rendering_speed', tooltip: 'paintings.generate.rendering_speed_tip' },
      {
        type: 'select',
        key: 'renderingSpeed',
        options: RENDERING_SPEED_OPTIONS,
        initialValue: 'DEFAULT',
        disabled: (_config, painting) => {
          const model = painting?.model
          return !model || !model.includes('V_3')
        }
      },
      { type: 'title', title: 'paintings.aspect_ratio' },
      {
        type: 'select',
        key: 'aspectRatio',
        options: ASPECT_RATIOS.map((size) => ({
          label: size.label,
          value: size.value,
          icon: size.icon
        }))
      },
      {
        type: 'title',
        title: 'paintings.number_images',
        tooltip: 'paintings.generate.number_images_tip'
      },
      {
        type: 'slider',
        key: 'numImages',
        min: 1,
        max: 8
      },
      {
        type: 'title',
        title: 'paintings.style_type',
        tooltip: 'paintings.generate.style_type_tip'
      },
      {
        type: 'select',
        key: 'styleType',
        options: (_config, painting) => {
          // 根据模型选择显示不同的样式类型选项
          return painting?.model?.includes('V_3') ? V3_STYLE_TYPES : STYLE_TYPES
        },
        disabled: false
      },
      {
        type: 'title',
        title: 'paintings.seed',
        tooltip: 'paintings.generate.seed_tip'
      },
      {
        type: 'input',
        key: 'seed'
      },
      {
        type: 'title',
        title: 'paintings.negative_prompt',
        tooltip: 'paintings.generate.negative_prompt_tip'
      },
      {
        type: 'textarea',
        key: 'negativePrompt'
      },
      {
        type: 'title',
        title: 'paintings.magic_prompt_option',
        tooltip: 'paintings.generate.magic_prompt_option_tip'
      },
      {
        type: 'switch',
        key: 'magicPromptOption'
      }
    ],
    edit: [
      { type: 'title', title: 'paintings.edit.image_file' },
      {
        type: 'image',
        key: 'imageFile'
      },
      { type: 'title', title: 'paintings.model', tooltip: 'paintings.edit.model_tip' },
      {
        type: 'select',
        key: 'model',
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
      { type: 'title', title: 'paintings.rendering_speed', tooltip: 'paintings.edit.rendering_speed_tip' },
      {
        type: 'select',
        key: 'renderingSpeed',
        options: RENDERING_SPEED_OPTIONS,
        initialValue: 'DEFAULE',
        disabled: (_config, painting) => {
          const model = painting?.model
          return !model || !model.includes('V_3')
        }
      },
      {
        type: 'title',
        title: 'paintings.number_images',
        tooltip: 'paintings.edit.number_images_tip'
      },
      {
        type: 'slider',
        key: 'numImages',
        min: 1,
        max: 8
      },
      {
        type: 'title',
        title: 'paintings.style_type',
        tooltip: 'paintings.edit.style_type_tip'
      },
      {
        type: 'select',
        key: 'styleType',
        options: (_config, painting) => {
          // 根据模型选择显示不同的样式类型选项
          return painting?.model?.includes('V_3') ? V3_STYLE_TYPES : STYLE_TYPES
        },
        disabled: false
      },
      {
        type: 'title',
        title: 'paintings.seed',
        tooltip: 'paintings.edit.seed_tip'
      },
      {
        type: 'input',
        key: 'seed'
      },
      {
        type: 'title',
        title: 'paintings.magic_prompt_option',
        tooltip: 'paintings.edit.magic_prompt_option_tip'
      },
      {
        type: 'switch',
        key: 'magicPromptOption'
      }
    ],
    remix: [
      { type: 'title', title: 'paintings.remix.image_file' },
      {
        type: 'image',
        key: 'imageFile'
      },
      { type: 'title', title: 'paintings.model', tooltip: 'paintings.remix.model_tip' },
      {
        type: 'select',
        key: 'model',
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
      { type: 'title', title: 'paintings.rendering_speed', tooltip: 'paintings.remix.rendering_speed_tip' },
      {
        type: 'select',
        key: 'renderingSpeed',
        options: RENDERING_SPEED_OPTIONS,
        initialValue: 'DEFAULT',
        disabled: (_config, painting) => {
          const model = painting?.model
          return !model || !model.includes('V_3')
        }
      },
      { type: 'title', title: 'paintings.aspect_ratio' },
      {
        type: 'select',
        key: 'aspectRatio',
        options: ASPECT_RATIOS.map((size) => ({
          label: size.label,
          value: size.value,
          icon: size.icon
        }))
      },
      { type: 'title', title: 'paintings.remix.image_weight' },
      {
        type: 'slider',
        key: 'imageWeight',
        min: 1,
        max: 100
      },
      {
        type: 'title',
        title: 'paintings.number_images',
        tooltip: 'paintings.remix.number_images_tip'
      },
      {
        type: 'slider',
        key: 'numImages',
        min: 1,
        max: 8
      },
      {
        type: 'title',
        title: 'paintings.style_type',
        tooltip: 'paintings.remix.style_type_tip'
      },
      {
        type: 'select',
        key: 'styleType',
        options: (_config, painting) => {
          // 根据模型选择显示不同的样式类型选项
          return painting?.model?.includes('V_3') ? V3_STYLE_TYPES : STYLE_TYPES
        },
        disabled: false
      },
      {
        type: 'title',
        title: 'paintings.seed',
        tooltip: 'paintings.remix.seed_tip'
      },
      {
        type: 'input',
        key: 'seed'
      },
      {
        type: 'title',
        title: 'paintings.negative_prompt',
        tooltip: 'paintings.remix.negative_prompt_tip'
      },
      {
        type: 'textarea',
        key: 'negativePrompt'
      },
      {
        type: 'title',
        title: 'paintings.magic_prompt_option',
        tooltip: 'paintings.remix.magic_prompt_option_tip'
      },
      {
        type: 'switch',
        key: 'magicPromptOption'
      }
    ],
    upscale: [
      { type: 'title', title: 'paintings.upscale.image_file' },
      {
        type: 'image',
        key: 'imageFile',
        required: true
      },
      { type: 'title', title: 'paintings.upscale.resemblance', tooltip: 'paintings.upscale.resemblance_tip' },
      { type: 'slider', key: 'resemblance', min: 1, max: 100 },
      { type: 'title', title: 'paintings.upscale.detail', tooltip: 'paintings.upscale.detail_tip' },
      {
        type: 'slider',
        key: 'detail',
        min: 1,
        max: 100
      },
      {
        type: 'title',
        title: 'paintings.number_images',
        tooltip: 'paintings.upscale.number_images_tip'
      },
      {
        type: 'slider',
        key: 'numImages',
        min: 1,
        max: 8
      },
      {
        type: 'title',
        title: 'paintings.seed',
        tooltip: 'paintings.upscale.seed_tip'
      },
      {
        type: 'input',
        key: 'seed'
      },
      {
        type: 'title',
        title: 'paintings.magic_prompt_option',
        tooltip: 'paintings.upscale.magic_prompt_option_tip'
      },
      {
        type: 'switch',
        key: 'magicPromptOption'
      }
    ]
  }
}
