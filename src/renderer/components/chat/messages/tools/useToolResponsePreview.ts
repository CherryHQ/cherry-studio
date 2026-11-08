import { useMemo } from 'react'

import { useToolResult } from '@renderer/hooks/useToolResult'
import { normalizeToolOutputResponse } from '@renderer/utils/message/toolOutput'
import {
  type DeferredToolOutput,
  envelopeDisplayExcerpt,
  isDeferredToolOutput,
  isPersistedToolOutput
} from '@shared/ai/transport'

import { useMessagePartsScopeId } from '../blocks/MessagePartsContext'
import { useOptionalMessageListTopicId } from '../MessageListProvider'
import type { ToolResponseLike } from './toolResponse'

export function useToolOutputReference(response: unknown, toolCallId?: string): DeferredToolOutput | undefined {
  const scopeMessageId = useMessagePartsScopeId()
  const topicId = useOptionalMessageListTopicId()
  return useMemo(() => {
    if (isDeferredToolOutput(response)) return response
    if (isPersistedToolOutput(response) && topicId && scopeMessageId && toolCallId) {
      const ref = response.$persistedToolOutput
      return {
        $deferredToolResult: { topicId, messageId: scopeMessageId, toolCallId },
        excerpt: envelopeDisplayExcerpt(ref),
        ...(ref.shape === 'entities' ? { skeleton: ref.skeleton } : {})
      }
    }
    return undefined
  }, [response, scopeMessageId, toolCallId, topicId])
}

export function useToolResponsePreview<T extends ToolResponseLike>(toolResponse: T) {
  const deferredOutput = useToolOutputReference(toolResponse.response, toolResponse.toolCallId)
  const { output, generation } = useToolResult(deferredOutput?.$deferredToolResult, 'preview')
  const preview = useMemo(() => {
    if (!deferredOutput) return toolResponse
    const preview = output ?? deferredOutput.skeleton
    if (preview !== undefined) return { ...toolResponse, response: normalizeToolOutputResponse(preview) }
    const excerpt = deferredOutput.excerpt
    return {
      ...toolResponse,
      response: excerpt
        ? normalizeToolOutputResponse([excerpt.head, '…', excerpt.tail].filter(Boolean).join('\n'))
        : undefined
    }
  }, [deferredOutput, output, toolResponse])
  return { toolResponse: preview, deferredOutput, generation }
}
