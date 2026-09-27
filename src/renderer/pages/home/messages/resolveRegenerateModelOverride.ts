import { isFailedAssistantMessage, type CherryUIMessage } from '@shared/data/types/message'
import { isUniqueModelId, type UniqueModelId } from '@shared/data/types/model'

export function resolveRegenerateModelOverride(
  message: CherryUIMessage | undefined,
  composerActiveModelId: UniqueModelId | undefined
): UniqueModelId | undefined {
  if (!composerActiveModelId || !message || !isFailedAssistantMessage(message)) return undefined

  const messageModelId = message.metadata?.modelId
  if (!isUniqueModelId(messageModelId)) return composerActiveModelId

  return composerActiveModelId !== messageModelId ? composerActiveModelId : undefined
}
