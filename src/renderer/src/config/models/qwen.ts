import { getLowerBaseModelName } from '@renderer/utils'

import type { ClassifiableModel } from './classifiable'

export const isQwenMTModel = (model: ClassifiableModel): boolean => {
  const modelId = getLowerBaseModelName(model.id)
  return modelId.includes('qwen-mt')
}

/**
 * Checks if the model is a Qwen 3.5~3.9 series model.
 *
 * This function determines whether the given model belongs to the Qwen 3.5–3.9 series
 * by checking if its ID starts with 'qwen3.' followed by a single digit 5–9.
 * The check is case-insensitive.
 *
 * @param model - The model to check, can be undefined.
 * @returns `true` if the model is a Qwen 3.5–3.9 series model, `false` otherwise.
 */
export function isQwen35to39Model(model?: ClassifiableModel): boolean {
  if (!model) {
    return false
  }
  const modelId = getLowerBaseModelName(model.id, '/')
  return /^qwen3\.[5-9]/.test(modelId)
}
