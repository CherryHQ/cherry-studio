import { t } from '@main/i18n'
import type { CherryMessagePart } from '@shared/data/types/message'
import { type Model, parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import { isVisionModel } from '@shared/utils/model'

import { UnsupportedAgentImageInputError } from '../admission'

export function assertAgentImageInput(
  agentType: string,
  uniqueModelId: UniqueModelId,
  parts: readonly CherryMessagePart[] | undefined,
  resolveModel: (providerId: string, modelId: string) => Model
): void {
  if (agentType !== 'pi' && agentType !== 'pi-durable') return
  if (!parts?.some((part) => part.type === 'file' && part.mediaType.startsWith('image/'))) return
  const { providerId, modelId } = parseUniqueModelId(uniqueModelId)
  const model = resolveModel(providerId, modelId)
  if (!isVisionModel(model)) {
    throw new UnsupportedAgentImageInputError(
      modelId,
      t('agent.session.pi.unsupported_image_input', { model: modelId })
    )
  }
}
