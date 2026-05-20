import { uuid } from '@renderer/utils'

import type { DmxapiPaintingData as DmxapiPainting } from '../../model/types/paintingData'
import { generationModeType } from '../../model/types/paintingData'

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

export const COURSE_URL = 'http://seedream.dmxapi.cn/'

export const TOP_UP_URL = 'https://www.dmxapi.cn/topup'

export const DEFAULT_PAINTING: DmxapiPainting = {
  id: uuid(),
  providerId: 'dmxapi',
  mode: 'generate',
  files: [],
  prompt: '',
  image_size: '1328x1328',
  aspect_ratio: '1:1',
  n: 1,
  seed: '',
  model: '', // 将在运行时动态设置
  autoCreate: false,
  generationMode: generationModeType.GENERATION
}

export const MODEOPTIONS = [
  { labelKey: 'paintings.mode.generate', value: generationModeType.GENERATION },
  { labelKey: 'paintings.mode.edit', value: generationModeType.EDIT },
  { labelKey: 'paintings.mode.merge', value: generationModeType.MERGE }
]
