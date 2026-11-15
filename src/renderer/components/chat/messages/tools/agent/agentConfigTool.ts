import type { McpToolResponse, NormalToolResponse } from '@renderer/types/mcpTool'
import { type AgentConfigToolKind, getAgentConfigToolKind as kindOf } from '@shared/ai/agentConfigToolKind'
import { parseFunctionCallToolName } from '@shared/ai/tools/mcpToolName'

/** Which Agent create/configure tool this is, across runtimes; undefined for any other tool. */
export function getAgentConfigToolKind(
  toolResponse: Pick<McpToolResponse | NormalToolResponse, 'tool'>
): AgentConfigToolKind | undefined {
  const { tool } = toolResponse
  if (tool.type === 'mcp' && 'serverId' in tool) return kindOf(tool.serverId, tool.name)
  const parsed = parseFunctionCallToolName(tool.name) ?? parseFunctionCallToolName(tool.id)
  return parsed ? kindOf(parsed.serverPart, parsed.toolPart) : undefined
}
