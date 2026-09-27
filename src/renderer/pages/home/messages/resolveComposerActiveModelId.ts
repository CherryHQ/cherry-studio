import { isUniqueModelId, type UniqueModelId } from '@shared/data/types/model'

export function resolveComposerActiveModelId(
  selectorModels: ReadonlyArray<{ id?: string }>,
  assistantModelId?: string
): UniqueModelId | undefined {
  if (selectorModels.length > 1) return undefined

  if (selectorModels.length === 1) {
    const fromSelector = selectorModels[0]?.id
    if (fromSelector && isUniqueModelId(fromSelector)) return fromSelector
  }

  if (assistantModelId && isUniqueModelId(assistantModelId)) return assistantModelId

  return undefined
}
