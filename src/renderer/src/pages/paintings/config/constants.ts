import ImageSize1_1 from '@renderer/assets/images/paintings/image-size-1-1.svg'
import ImageSize1_2 from '@renderer/assets/images/paintings/image-size-1-2.svg'
import ImageSize3_2 from '@renderer/assets/images/paintings/image-size-3-2.svg'
import ImageSize3_4 from '@renderer/assets/images/paintings/image-size-3-4.svg'
import ImageSize9_16 from '@renderer/assets/images/paintings/image-size-9-16.svg'
import ImageSize16_9 from '@renderer/assets/images/paintings/image-size-16-9.svg'
import type { PaintingAction } from '@renderer/types'

// 几种默认的绘画配置
export const DEFAULT_PAINTING: PaintingAction = {
  id: 'aihubmix_1',
  model: 'V_3',
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
  renderingSpeed: 'DEFAULT'
}

export const ASPECT_RATIOS = [
  {
    label: '1:1',
    value: 'ASPECT_1_1',
    icon: ImageSize1_1
  },
  {
    label: '3:1',
    value: 'ASPECT_3_1',
    icon: ImageSize3_2
  },
  {
    label: '1:3',
    value: 'ASPECT_1_3',
    icon: ImageSize1_2
  },
  {
    label: '3:2',
    value: 'ASPECT_3_2',
    icon: ImageSize3_2
  },
  {
    label: '2:3',
    value: 'ASPECT_2_3',
    icon: ImageSize1_2
  },
  {
    label: '4:3',
    value: 'ASPECT_4_3',
    icon: ImageSize3_4
  },
  {
    label: '3:4',
    value: 'ASPECT_3_4',
    icon: ImageSize3_4
  },
  {
    label: '16:9',
    value: 'ASPECT_16_9',
    icon: ImageSize16_9
  },
  {
    label: '9:16',
    value: 'ASPECT_9_16',
    icon: ImageSize9_16
  },
  {
    label: '16:10',
    value: 'ASPECT_16_10',
    icon: ImageSize16_9
  },
  {
    label: '10:16',
    value: 'ASPECT_10_16',
    icon: ImageSize9_16
  }
]

export const STYLE_TYPES = [
  {
    label: 'paintings.style_types.auto',
    value: 'AUTO'
  },
  {
    label: 'paintings.style_types.general',
    value: 'GENERAL'
  },
  {
    label: 'paintings.style_types.realistic',
    value: 'REALISTIC'
  },
  {
    label: 'paintings.style_types.design',
    value: 'DESIGN'
  },
  {
    label: 'paintings.style_types.3d',
    value: 'RENDER_3D',
    onlyV2: true // 仅V2模型支持
  },
  {
    label: 'paintings.style_types.anime',
    value: 'ANIME',
    onlyV2: true // 仅V2模型支持
  }
]

// V3模型支持的样式类型
export const V3_STYLE_TYPES = STYLE_TYPES.filter((style) => !style.onlyV2)

// 新增V3渲染速度选项
export const RENDERING_SPEED_OPTIONS = [
  {
    label: 'paintings.rendering_speeds.default',
    value: 'DEFAULT'
  },
  {
    label: 'paintings.rendering_speeds.turbo',
    value: 'TURBO'
  },
  {
    label: 'paintings.rendering_speeds.quality',
    value: 'QUALITY'
  }
]
