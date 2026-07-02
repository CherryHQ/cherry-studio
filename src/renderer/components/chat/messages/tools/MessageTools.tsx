import type { McpToolResponse, NormalToolResponse } from '@renderer/types/mcpTool'
import type { McpTool } from '@renderer/types/tool'

import { isReportArtifactsToolResponse } from './agent/ReportArtifacts'
import MessageMcpTool from './mcp/MessageMcpTool'
import MessageTool, { canRenderMessageToolResponse } from './MessageTool'

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

export default function MessageTools({ toolResponse }: Props) {
  if (isReportArtifactsToolResponse(toolResponse)) return null
  const rendered = rendersThroughChooseTool(toolResponse) ? (
    <MessageTool toolResponse={toolResponse as NormalToolResponse} />
  ) : (
    <MessageMcpTool toolResponse={toolResponse as McpToolResponse} />
  )
  return (
    // `contents` keeps this out of layout entirely; it only exists to expose the wire tool name
    // (e.g. "web_search", "kb_search"), its call arguments, and its status for e2e. This is the
    // single choke point both single-entry (ToolPartView) and grouped-entry
    // (ToolBlockGroupContent) rendering call through, so it covers a tool call regardless of
    // whether it got bundled with adjacent tool calls. `data-tool-args` matters most for a
    // meta-tool like `tool_invoke`, whose own wire name never reveals which deferred tool it
    // dispatched to (that's `arguments.name`); `data-tool-status` lets a test tell an executed
    // call apart from one whose inner dispatch errored (`'error'` vs `'done'`).
    <div
      className="contents"
      data-tool-name={toolResponse.tool.name}
      data-tool-args={JSON.stringify(toolResponse.arguments ?? {})}
      data-tool-status={toolResponse.status}>
      {rendered}
    </div>
  )
}
