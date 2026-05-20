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

export function createDefaultZhipuPainting(modelOptions?: ModelOption[]) {
  return {
    ...DEFAULT_PAINTING,
    id: uuid(),
    model: modelOptions?.[0]?.value ?? ''
  }
}
