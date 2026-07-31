import { useMemo } from 'react'

import { useToolResult } from '@renderer/hooks/useToolResult'
import type { McpToolResponse, NormalToolResponse } from '@renderer/types/mcpTool'
import type { McpTool } from '@renderer/types/tool'
import { normalizeToolOutputResponse } from '@renderer/utils/message/toolOutput'
import type { DeferredToolOutput } from '@shared/ai/transport'
import { envelopeDisplayExcerpt, isDeferredToolOutput, isPersistedToolOutput } from '@shared/ai/transport'

import { useMessagePartsScopeId } from '../blocks/MessagePartsContext'
import { useOptionalMessageListTopicId } from '../MessageListProvider'
import { isReportArtifactsToolResponse, MessageChannelConfigTool } from './agent'
import { isChannelAuthQrToolResponse } from './channelConfigTool'
import MessageMcpTool from './mcp/MessageMcpTool'
import MessageTool, { canRenderMessageToolResponse } from './MessageTool'
import { normalizeToolErrorResponse } from './toolResponse'

interface Props {
  toolResponse: McpToolResponse | NormalToolResponse
}

/**
 * In-process cherry / agent-memory tools are MCP-typed but have dedicated cards (web search,
 * knowledge, memory) — route them through `chooseTool` instead of the generic MCP renderer.
 * Other MCP servers keep the generic card.
 */
const DEDICATED_AGENT_SERVERS = new Set(['cherry-tools', 'agent-memory'])

function rendersThroughChooseTool(toolResponse: McpToolResponse | NormalToolResponse): boolean {
  const tool = toolResponse.tool
  if (tool.type !== 'mcp') return true
  return (
    DEDICATED_AGENT_SERVERS.has((tool as McpTool).serverId) &&
    canRenderMessageToolResponse(toolResponse as NormalToolResponse)
  )
}

export function canRenderMessageTool(toolResponse: McpToolResponse | NormalToolResponse) {
  if (isReportArtifactsToolResponse(toolResponse)) return false
  if (isChannelAuthQrToolResponse(toolResponse)) return true
  if (toolResponse.tool.type === 'mcp' && !rendersThroughChooseTool(toolResponse)) return true
  return canRenderMessageToolResponse(toolResponse as NormalToolResponse)
}

/**
 * The single gate every tool card passes through, so it holds the invariant they rely on:
 * `toolResponse.response` is always the real value, never a deferred placeholder.
 */
export default function MessageTools({ toolResponse }: Props) {
  const scopeMessageId = useMessagePartsScopeId()
  const topicId = useOptionalMessageListTopicId()
  const deferredOutput = useMemo((): DeferredToolOutput | undefined => {
    const response = toolResponse.response
    if (isDeferredToolOutput(response)) return response
    // Cold-loaded parts arrive unprojected (the topics GET serves raw message
    // data), so a bare persisted envelope can reach here — convert it to the
    // same deferred reference + excerpt the stream projection produces.
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

  const resolvedToolResponse = useMemo(() => {
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

  if (isReportArtifactsToolResponse(resolvedToolResponse)) return null
  if (isChannelAuthQrToolResponse(resolvedToolResponse)) {
    return <MessageChannelConfigTool toolResponse={resolvedToolResponse} />
  }
  if (rendersThroughChooseTool(resolvedToolResponse)) {
    return <MessageTool toolResponse={resolvedToolResponse as NormalToolResponse} />
  }
  return <MessageMcpTool toolResponse={resolvedToolResponse} />
}
