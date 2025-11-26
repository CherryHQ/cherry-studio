import type { Model } from '@renderer/types'
import { getLowerBaseModelName } from '@renderer/utils'

export const isQwenMTModel = (model: Model): boolean => {
  const modelId = getLowerBaseModelName(model.id)
  return modelId.includes('qwen-mt')
}
