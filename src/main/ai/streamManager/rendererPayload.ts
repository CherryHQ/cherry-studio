import { projectMessagePartsForRenderer, projectStreamChunkForRenderer } from '@main/utils/messageOutputProjection'
import type { StreamChunkPayload } from '@shared/ai/transport'
import type { CherryUIMessage } from '@shared/data/types/message'

export function projectStreamMessageForRenderer(topicId: string, message: CherryUIMessage): CherryUIMessage {
  const parts = projectMessagePartsForRenderer(message.parts, topicId, message.id)
  return parts === message.parts ? message : ({ ...message, parts } as CherryUIMessage)
}

export function projectStreamChunkPayloadForRenderer(payload: StreamChunkPayload): StreamChunkPayload {
  const chunk = projectStreamChunkForRenderer(payload.chunk, payload.topicId, payload.anchorMessageId)
  return chunk === payload.chunk ? payload : { ...payload, chunk }
}
