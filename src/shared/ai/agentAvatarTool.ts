import { buildFunctionCallToolName } from './tools/mcpToolName'

export const AGENT_AVATAR_TOOL_NAME = 'agent_avatar'
export const CLAUDE_AGENT_AVATAR_TOOL_ID = `mcp__cherry-tools__${AGENT_AVATAR_TOOL_NAME}`
export const PI_AGENT_AVATAR_TOOL_ID = `mcp__cherry_tools__${AGENT_AVATAR_TOOL_NAME}`
export const AGENT_AVATAR_TOOL_LABEL = 'Change Agent Avatar'
export const AGENT_AVATAR_TOOL_DESCRIPTION =
  'Generates and applies an Agent avatar using the configured painting model, or restores the previous avatar.'

const avatarToolIds = new Set([
  CLAUDE_AGENT_AVATAR_TOOL_ID,
  PI_AGENT_AVATAR_TOOL_ID,
  buildFunctionCallToolName('cherry-tools', AGENT_AVATAR_TOOL_NAME)
])

export function isAgentAvatarToolId(id: string): boolean {
  return avatarToolIds.has(id)
}
