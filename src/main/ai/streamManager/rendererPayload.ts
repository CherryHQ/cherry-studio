import {
  omitClaudeCodeRawPayload,
  projectAgentMessagePartForRenderer,
  withDeferredToolResultRef
} from '@data/services/utils/agentSessionMessageProjection'
import { isAgentSessionTopic } from '@main/ai/agentSession/topic'
import type { StreamChunkPayload } from '@shared/ai/transport'
import type { CherryUIMessage } from '@shared/data/types/message'
import type { UIMessageChunk } from 'ai'

export function projectStreamMessageForRenderer(topicId: string, message: CherryUIMessage): CherryUIMessage {
  if (!isAgentSessionTopic(topicId)) return message
  return {
    ...message,
    parts: message.parts.map((part) => projectAgentMessagePartForRenderer(part, message.id))
  } as CherryUIMessage
}

export function projectStreamChunkForRenderer(
  topicId: string,
  chunk: UIMessageChunk,
  messageId?: string
): UIMessageChunk {
  if (!isAgentSessionTopic(topicId)) return chunk

  const source = chunk as UIMessageChunk & { providerMetadata?: unknown }
  let providerMetadata = omitClaudeCodeRawPayload(source.providerMetadata)
  const isToolResult = chunk.type === 'tool-output-available' || chunk.type === 'tool-output-error'
  const toolCallId = isToolResult ? chunk.toolCallId : undefined
  const shouldDeferResult = !!messageId && !!toolCallId && isToolResult

  if (shouldDeferResult) {
    providerMetadata = withDeferredToolResultRef(providerMetadata, {
      messageId,
      toolCallId,
      kind: chunk.type === 'tool-output-error' ? 'error' : 'output'
    })
  }
  if (!shouldDeferResult && providerMetadata === source.providerMetadata) return chunk

  return {
    ...chunk,
    ...(shouldDeferResult && chunk.type === 'tool-output-available' ? { output: '' } : {}),
    ...(shouldDeferResult && chunk.type === 'tool-output-error' ? { errorText: '' } : {}),
    ...(providerMetadata !== source.providerMetadata ? { providerMetadata } : {})
  } as UIMessageChunk
}

export function projectStreamChunkPayloadForRenderer(payload: StreamChunkPayload): StreamChunkPayload {
  const chunk = projectStreamChunkForRenderer(payload.topicId, payload.chunk, payload.anchorMessageId)
  return chunk === payload.chunk ? payload : { ...payload, chunk }
}
