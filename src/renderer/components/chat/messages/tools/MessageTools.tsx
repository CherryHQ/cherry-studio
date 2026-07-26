import { useToolResult } from '@renderer/hooks/useToolResult'
import type { McpToolResponse, NormalToolResponse } from '@renderer/types/mcpTool'
import type { McpTool } from '@renderer/types/tool'
import { isDeferredToolOutput } from '@shared/ai/transport'
import { useMemo } from 'react'

import { isReportArtifactsToolResponse } from './agent'
import MessageMcpTool from './mcp/MessageMcpTool'
import MessageTool, { canRenderMessageToolResponse } from './MessageTool'
import { normalizeToolErrorResponse, normalizeToolOutputResponse } from './toolResponse'

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
  if (toolResponse.tool.type === 'mcp' && !rendersThroughChooseTool(toolResponse)) return true
  return canRenderMessageToolResponse(toolResponse as NormalToolResponse)
}

/**
 * The single gate every tool card passes through, so it holds the invariant they rely on:
 * `toolResponse.response` is always the real value, never a deferred placeholder.
 */
export default function MessageTools({ toolResponse }: Props) {
  const deferredOutput = isDeferredToolOutput(toolResponse.response) ? toolResponse.response : undefined
  const { output, error, isLoading } = useToolResult(deferredOutput?.$deferredToolResult)

  const resolvedToolResponse = useMemo(() => {
    if (!deferredOutput) return toolResponse
    if (isLoading) return { ...toolResponse, status: 'invoking' as const, response: undefined }
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
  if (rendersThroughChooseTool(resolvedToolResponse)) {
    return <MessageTool toolResponse={resolvedToolResponse as NormalToolResponse} />
  }
  return <MessageMcpTool toolResponse={resolvedToolResponse as McpToolResponse} />
}
