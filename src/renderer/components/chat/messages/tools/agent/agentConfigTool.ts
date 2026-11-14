import type { McpToolResponse, NormalToolResponse } from '@renderer/types/mcpTool'
import { AGENT_CREATE_TOOL_NAME, CONFIG_UPDATE_TOOL_NAME } from '@shared/ai/builtinTools'
import { parseFunctionCallToolName } from '@shared/ai/tools/mcpToolName'

/** `create` makes a new Agent, `update` changes another Agent, `self_update` changes this conversation's Agent. */
export type AgentConfigToolKind = 'create' | 'update' | 'self_update'

const KIND_BY_TOOL: Record<string, AgentConfigToolKind> = {
  'assistant/create_agent': 'create',
  'assistant/update_agent': 'update',
  [`cherry-tools/${AGENT_CREATE_TOOL_NAME}`]: 'create',
  [`cherry-tools/${CONFIG_UPDATE_TOOL_NAME}`]: 'self_update'
}

function serverAndToolName(tool: (McpToolResponse | NormalToolResponse)['tool']): string | undefined {
  if (tool.type === 'mcp' && 'serverId' in tool) return `${tool.serverId}/${tool.name}`
  const parsed = parseFunctionCallToolName(tool.name) ?? parseFunctionCallToolName(tool.id)
  return parsed ? `${parsed.serverPart}/${parsed.toolPart}` : undefined
}

/** Which Agent create/configure tool this is, across runtimes; undefined for any other tool. */
export function getAgentConfigToolKind(
  toolResponse: Pick<McpToolResponse | NormalToolResponse, 'tool'>
): AgentConfigToolKind | undefined {
  const name = serverAndToolName(toolResponse.tool)
  // Pi sanitizes `cherry-tools` to `cherry_tools` in its wire names.
  return name ? KIND_BY_TOOL[name.replace(/^cherry_tools\//, 'cherry-tools/')] : undefined
}
