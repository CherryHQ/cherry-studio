import type { Model } from '@renderer/types'
import { uuid } from '@renderer/utils'

export const COURSE_URL = 'https://docs.bigmodel.cn/cn/guide/models/image-generation/cogview-4'
export const TOP_UP_URL = 'https://zhipuaishengchan.datasink.sensorsdata.cn/t/iv'

export const ZHIPU_PAINTING_MODELS: Model[] = [
  {
    id: 'cogview-3-flash',
    provider: 'zhipu',
    name: 'CogView-3-Flash',
    group: 'CogView'
  },
  {
    id: 'cogview-4-250304',
    provider: 'zhipu',
    name: 'CogView-4-250304',
    group: 'CogView'
  }
]

export const DEFAULT_PAINTING = {
  id: uuid(),
  urls: [],
  files: [],
  prompt: '',
  negativePrompt: '',
  imageSize: '1024x1024',
  numImages: 1,
  seed: '',
  model: 'cogview-3-flash',
  quality: 'standard'
}

export const QUALITY_OPTIONS = [
  { label: 'paintings.zhipu.quality_options.standard_default', value: 'standard' },
  { label: 'paintings.zhipu.quality_options.hd', value: 'hd' }
]

export const IMAGE_SIZES = [
  { label: 'paintings.zhipu.image_sizes.1024x1024_default', value: '1024x1024' },
  { label: 'paintings.zhipu.image_sizes.768x1344', value: '768x1344' },
  { label: 'paintings.zhipu.image_sizes.864x1152', value: '864x1152' },
  { label: 'paintings.zhipu.image_sizes.1344x768', value: '1344x768' },
  { label: 'paintings.zhipu.image_sizes.1152x864', value: '1152x864' },
  { label: 'paintings.zhipu.image_sizes.1440x720', value: '1440x720' },
  { label: 'paintings.zhipu.image_sizes.720x1440', value: '720x1440' }
]
