import type { UniqueModelId } from '@shared/data/types/model'

export function resolveResendModelIds(inheritedModelIds: UniqueModelId[], hasAssistant: boolean): UniqueModelId[] {
  return inheritedModelIds.length > 1 || (!hasAssistant && inheritedModelIds.length === 1) ? inheritedModelIds : []
}
