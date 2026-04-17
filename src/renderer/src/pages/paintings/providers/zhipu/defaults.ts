import { uuid } from '@renderer/utils'

import { DEFAULT_PAINTING } from './config'

export { COURSE_URL, DEFAULT_PAINTING, IMAGE_SIZES, QUALITY_OPTIONS, TOP_UP_URL, ZHIPU_PAINTING_MODELS } from './config'

export function createDefaultZhipuPainting() {
  return {
    ...DEFAULT_PAINTING,
    id: uuid()
  }
}
