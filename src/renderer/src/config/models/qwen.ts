import type { Model } from '@renderer/types'
import { getLowerBaseModelName } from '@renderer/utils'

export const isQwenMTModel = (model: Model): boolean => {
  const modelId = getLowerBaseModelName(model.id)
  return modelId.includes('qwen-mt')
}

/**
 * Checks if the model is a Qwen 3.5 series model.
 *
 * This function determines whether the given model belongs to the Qwen 3.5 series
 * by checking if its ID starts with 'qwen3.5'. The check is case-insensitive.
 *
 * @param model - The model to check, can be undefined.
 * @returns `true` if the model is a Qwen 3.5 series model, `false` otherwise.
 */
export function isQwen35Model(model?: Model): boolean {
  if (!model) {
    return false
  }
  const modelId = getLowerBaseModelName(model.id, '/')
  return modelId.startsWith('qwen3.5')
}
