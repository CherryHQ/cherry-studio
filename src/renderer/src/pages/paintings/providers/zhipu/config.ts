import { uuid } from '@renderer/utils'

import type { ModelOption } from '../../model/types/paintingModel'

export const COURSE_URL = 'https://docs.bigmodel.cn/cn/guide/models/image-generation/cogview-4'
export const TOP_UP_URL = 'https://zhipuaishengchan.datasink.sensorsdata.cn/t/iv'

export const DEFAULT_PAINTING = {
  id: uuid(),
  providerId: 'zhipu' as const,
  mode: 'generate' as const,
  files: [],
  prompt: '',
  negativePrompt: '',
  imageSize: '1024x1024',
  numImages: 1,
  seed: '',
  model: '',
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

export function createDefaultZhipuPainting(modelOptions?: ModelOption[]) {
  return {
    ...DEFAULT_PAINTING,
    id: uuid(),
    model: modelOptions?.[0]?.value ?? ''
  }
}
