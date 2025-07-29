import ImageSize1_1 from '@renderer/assets/images/paintings/image-size-1-1.svg'
import ImageSize1_2 from '@renderer/assets/images/paintings/image-size-1-2.svg'
import ImageSize3_2 from '@renderer/assets/images/paintings/image-size-3-2.svg'
import ImageSize3_4 from '@renderer/assets/images/paintings/image-size-3-4.svg'
import ImageSize9_16 from '@renderer/assets/images/paintings/image-size-9-16.svg'
import ImageSize16_9 from '@renderer/assets/images/paintings/image-size-16-9.svg'
import { uuid } from '@renderer/utils'
import { t } from 'i18next'

import { DmxapiPainting, generationModeType } from '../../../types'

// 模型数据类型
export type DMXApiModelData = {
  id: string
  provider: string
  name: string
  price: string
}

// 模型分组类型
export type DMXApiModelGroups = {
  TEXT_TO_IMAGES?: Record<string, DMXApiModelData[]>
  IMAGE_EDIT?: Record<string, DMXApiModelData[]>
  IMAGE_MERGE?: Record<string, DMXApiModelData[]>
}

export const STYLE_TYPE_OPTIONS = [
  { label: '吉卜力', value: '吉卜力' },
  { label: '皮克斯', value: '皮克斯' },
  { label: '绒线玩偶', value: '绒线玩偶' },
  { label: '水彩画', value: '水彩画' },
  { label: '卡通插画', value: '卡通插画' },
  { label: '3D卡通', value: '3D卡通' },
  { label: '日系动漫', value: '日系动漫' },
  { label: '木雕', value: '木雕' },
  { label: '唯美古风', value: '唯美古风' },
  { label: '2.5D动画', value: '2.5D动画' },
  { label: '清新日漫', value: '清新日漫' },
  { label: '黏土', value: '黏土' },
  { label: '小人书插画', value: '小人书插画' },
  { label: '浮世绘', value: '浮世绘' },
  { label: '毛毡', value: '毛毡' },
  { label: '美式复古', value: '美式复古' },
  { label: '赛博朋克', value: '赛博朋克' },
  { label: '素描', value: '素描' },
  { label: '莫奈花园', value: '莫奈花园' },
  { label: '厚涂手绘', value: '厚涂手绘' },
  { label: '扁平', value: '扁平' },
  { label: '肌理', value: '肌理' },
  { label: '像素艺术', value: '像素艺术' },
  { label: '街头艺术', value: '街头艺术' },
  { label: '迷幻', value: '迷幻' },
  { label: '国风工笔', value: '国风工笔' },
  { label: '巴洛克', value: '巴洛克' }
]

export const IMAGE_SIZES = [
  {
    label: '1:1',
    value: '1328x1328',
    icon: ImageSize1_1
  },
  {
    label: '1:2',
    value: '800x1600',
    icon: ImageSize1_2
  },
  {
    label: '3:2',
    value: '1584x1056',
    icon: ImageSize3_2
  },
  {
    label: '3:4',
    value: '1104x1472',
    icon: ImageSize3_4
  },
  {
    label: '16:9',
    value: '1664x936',
    icon: ImageSize16_9
  },
  {
    label: '9:16',
    value: '936x1664',
    icon: ImageSize9_16
  }
]

export const COURSE_URL = 'http://seedream.dmxapi.cn/'

export const DEFAULT_PAINTING: DmxapiPainting = {
  id: uuid(),
  urls: [],
  files: [],
  prompt: '',
  image_size: '1328x1328',
  aspect_ratio: '1:1',
  n: 1,
  seed: '',
  style_type: '',
  model: '', // 将在运行时动态设置
  autoCreate: false,
  generationMode: generationModeType.GENERATION
}

export const MODEOPTIONS = [
  { label: 'paintings.mode.generate', value: generationModeType.GENERATION },
  { label: '改图', value: generationModeType.EDIT },
  { label: '合并图', value: generationModeType.MERGE }
]

// 获取模型分组数据
export const GetModelGroup = async (): Promise<DMXApiModelGroups> => {
  try {
    const response = await fetch('https://dmxapi.cn/cherry_painting_models.json')

    if (response.ok) {
      const data = await response.json()

      if (data) {
        return data
      }
    }
  } catch {
    /* empty */
  }
  window.message.error({
    content: t('paintings.req_error_model')
  })

  return {}
}
