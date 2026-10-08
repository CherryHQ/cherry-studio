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
import { normalizeToolErrorResponse, type ToolResponseLike } from './toolResponse'

export function useResolvedToolResponse(toolResponse: ToolResponseLike): ToolResponseLike {
  const scopeMessageId = useMessagePartsScopeId()
  const topicId = useOptionalMessageListTopicId()
  const deferredOutput = useMemo((): DeferredToolOutput | undefined => {
    const response = toolResponse.response
    if (isDeferredToolOutput(response)) return response
    // Cold-loaded parts can carry a persisted envelope instead of a deferred reference.
    if (isPersistedToolOutput(response) && topicId && scopeMessageId && toolResponse.toolCallId) {
      const ref = response.$persistedToolOutput
      return {
        $deferredToolResult: { topicId, messageId: scopeMessageId, toolCallId: toolResponse.toolCallId },
        excerpt: envelopeDisplayExcerpt(ref),
        ...(ref.shape === 'entities' ? { skeleton: ref.skeleton } : {})
      }
    }
    return undefined
  }, [scopeMessageId, toolResponse, topicId])
  const { output, error, isLoading } = useToolResult(deferredOutput?.$deferredToolResult)

  return useMemo(() => {
    if (!deferredOutput) return toolResponse
    if (isLoading) {
      // A persisted excerpt is real content — show it immediately instead of a
      // spinner; the resolved full value replaces it when the fetch lands.
      if (deferredOutput.excerpt) {
        const { head, tail } = deferredOutput.excerpt
        return { ...toolResponse, response: normalizeToolOutputResponse([head, '…', tail].filter(Boolean).join('\n')) }
      }
      return { ...toolResponse, status: 'invoking' as const, response: undefined }
    }
    if (error) {
      return {
        ...toolResponse,
        status: 'error' as const,
        response: normalizeToolErrorResponse(error instanceof Error ? error.message : String(error))
      }
    }
    return { ...toolResponse, response: normalizeToolOutputResponse(output) }
  }, [deferredOutput, error, isLoading, output, toolResponse])
}
