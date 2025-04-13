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
  model: 'V_2',
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
  urls: []
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
    value: 'SPECT_16_10',
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
    label: '自动',
    value: 'AUTO'
  },
  {
    label: '通用',
    value: 'GENERAL'
  },
  {
    label: '写实',
    value: 'REALISTIC'
  },
  {
    label: '设计',
    value: 'DESIGN'
  },
  {
    label: '3D',
    value: 'RENDER_3D'
  },
  {
    label: '动漫',
    value: 'ANIME'
  }
]
