import { uuid } from '@renderer/utils'
import { t } from 'i18next'

import type { DmxapiPainting } from '../../../types'
import { generationModeType } from '../../../types'

// 模型数据类型
export type DMXApiModelData = {
  id: string
  provider: string
  name: string
  price: string
  image_sizes: Array<{
    label: string
    value: string
  }>
  is_custom_size: boolean
  max_image_size?: number
  min_image_size?: number
}

// 模型分组类型
export type DMXApiModelGroups = {
  TEXT_TO_IMAGES?: Record<string, DMXApiModelData[]>
  IMAGE_EDIT?: Record<string, DMXApiModelData[]>
  IMAGE_MERGE?: Record<string, DMXApiModelData[]>
}

export const STYLE_TYPE_OPTIONS = [
  { labelKey: 'paintings.dmxapi.style_types.ghibli', value: '吉卜力' },
  { labelKey: 'paintings.dmxapi.style_types.pixar', value: '皮克斯' },
  { labelKey: 'paintings.dmxapi.style_types.yarn_doll', value: '绒线玩偶' },
  { labelKey: 'paintings.dmxapi.style_types.watercolor', value: '水彩画' },
  { labelKey: 'paintings.dmxapi.style_types.cartoon_illustration', value: '卡通插画' },
  { labelKey: 'paintings.dmxapi.style_types.3d_cartoon', value: '3D卡通' },
  { labelKey: 'paintings.dmxapi.style_types.japanese_anime', value: '日系动漫' },
  { labelKey: 'paintings.dmxapi.style_types.wood_carving', value: '木雕' },
  { labelKey: 'paintings.dmxapi.style_types.poetic_ancient', value: '唯美古风' },
  { labelKey: 'paintings.dmxapi.style_types.25d_animation', value: '2.5D动画' },
  { labelKey: 'paintings.dmxapi.style_types.fresh_anime', value: '清新日漫' },
  { labelKey: 'paintings.dmxapi.style_types.clay', value: '黏土' },
  { labelKey: 'paintings.dmxapi.style_types.little_people_book', value: '小人书插画' },
  { labelKey: 'paintings.dmxapi.style_types.ukiyo_e', value: '浮世绘' },
  { labelKey: 'paintings.dmxapi.style_types.felt', value: '毛毡' },
  { labelKey: 'paintings.dmxapi.style_types.american_retro', value: '美式复古' },
  { labelKey: 'paintings.dmxapi.style_types.cyberpunk', value: '赛博朋克' },
  { labelKey: 'paintings.dmxapi.style_types.sketch', value: '素描' },
  { labelKey: 'paintings.dmxapi.style_types.monet_garden', value: '莫奈花园' },
  { labelKey: 'paintings.dmxapi.style_types.oil_painting', value: '厚涂手绘' },
  { labelKey: 'paintings.dmxapi.style_types.flat', value: '扁平' },
  { labelKey: 'paintings.dmxapi.style_types.texture', value: '肌理' },
  { labelKey: 'paintings.dmxapi.style_types.pixel_art', value: '像素艺术' },
  { labelKey: 'paintings.dmxapi.style_types.street_art', value: '街头艺术' },
  { labelKey: 'paintings.dmxapi.style_types.psychedelic', value: '迷幻' },
  { labelKey: 'paintings.dmxapi.style_types.chinese_gongbi', value: '国风工笔' },
  { labelKey: 'paintings.dmxapi.style_types.baroque', value: '巴洛克' }
]

export const COURSE_URL = 'http://seedream.dmxapi.cn/'

export const TOP_UP_URL = 'https://www.dmxapi.cn/topup'

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
  { labelKey: 'paintings.mode.generate', value: generationModeType.GENERATION },
  { labelKey: 'paintings.mode.edit', value: generationModeType.EDIT },
  { labelKey: 'paintings.mode.merge', value: generationModeType.MERGE }
]

// 获取模型分组数据
export const GetModelGroup = async (): Promise<DMXApiModelGroups> => {
  try {
    const response = await fetch('https://dmxapi.cn/cherry_painting_models_v3.json')

    if (response.ok) {
      const data = await response.json()

      if (data) {
        return data
      }
    }
  } catch {
    /* empty */
  }
  window.toast.error(t('paintings.req_error_model'))

  return {}
}
