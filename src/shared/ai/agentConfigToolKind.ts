import { AGENT_CREATE_TOOL_NAME, ASSISTANT_CREATE_TOOL_NAME, CONFIG_UPDATE_TOOL_NAME } from './builtinTools'

/** `update` changes another Agent, `self_update` the calling Agent. */
export type AgentConfigToolKind = 'create_agent' | 'create_assistant' | 'update' | 'self_update'

const KIND_BY_TOOL: Record<string, AgentConfigToolKind> = {
  'assistant/create_agent': 'create_agent',
  'assistant/create_assistant': 'create_assistant',
  'assistant/update_agent': 'update',
  [`cherry-tools/${AGENT_CREATE_TOOL_NAME}`]: 'create_agent',
  [`cherry-tools/${ASSISTANT_CREATE_TOOL_NAME}`]: 'create_assistant',
  [`cherry-tools/${CONFIG_UPDATE_TOOL_NAME}`]: 'self_update'
}

/** Which Agent create/configure tool a server's tool is; undefined for any other tool. */
export function getAgentConfigToolKind(serverName: string, toolName: string): AgentConfigToolKind | undefined {
  // Pi sanitizes `cherry-tools` to `cherry_tools` in its wire names.
  return KIND_BY_TOOL[`${serverName === 'cherry_tools' ? 'cherry-tools' : serverName}/${toolName}`]
}
