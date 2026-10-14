import type { McpToolResponse, NormalToolResponse } from '@renderer/types/mcpTool'
import type { McpTool } from '@renderer/types/tool'

import { agentInlineResultPresentationRegistry, isReportArtifactsToolResponse, MessageChannelConfigTool } from './agent'
import { isChannelAuthQrToolResponse } from './channelConfigTool'
import MessageMcpTool from './mcp/MessageMcpTool'
import MessageTool, { canRenderMessageToolResponse } from './MessageTool'
import { useResolvedToolResponse } from './useResolvedToolResponse'

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

export default function MessageTools({ toolResponse }: Props) {
  const resolvedToolResponse = useResolvedToolResponse(toolResponse)

  const agentInlineResult = agentInlineResultPresentationRegistry.renderResult(resolvedToolResponse)
  if (agentInlineResult) return agentInlineResult
  if (isReportArtifactsToolResponse(resolvedToolResponse)) return null
  if (isChannelAuthQrToolResponse(resolvedToolResponse)) {
    return <MessageChannelConfigTool toolResponse={resolvedToolResponse} />
  }
  if (rendersThroughChooseTool(resolvedToolResponse)) {
    return <MessageTool toolResponse={resolvedToolResponse as NormalToolResponse} />
  }
  return <MessageMcpTool toolResponse={resolvedToolResponse} />
}
