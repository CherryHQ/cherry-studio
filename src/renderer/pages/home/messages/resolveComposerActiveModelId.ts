import { isUniqueModelId, type UniqueModelId } from '@shared/data/types/model'

/** Composer model used for regenerate override — only when exactly one selector model is active. */
export function resolveComposerActiveModelId(
  selectorModels: ReadonlyArray<{ id?: string }>
): UniqueModelId | undefined {
  if (selectorModels.length !== 1) return undefined

  const fromSelector = selectorModels[0]?.id
  if (fromSelector && isUniqueModelId(fromSelector)) return fromSelector

  return undefined
}
