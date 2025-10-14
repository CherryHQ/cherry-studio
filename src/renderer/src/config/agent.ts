import ClaudeAvatar from '@renderer/assets/images/models/claude.png'
import { AgentBase, AgentType } from '@renderer/types'

// base agent config. no default config for now.
const DEFAULT_AGENT_CONFIG: Omit<AgentBase, 'model'> = {
  accessible_paths: []
} as const

// no default config for now.
export const DEFAULT_CLAUDE_CODE_CONFIG: Omit<AgentBase, 'model'> = {
  ...DEFAULT_AGENT_CONFIG
} as const

export const getAgentTypeAvatar = (type: AgentType): string => {
  switch (type) {
    case 'claude-code':
      return ClaudeAvatar
    default:
      return ''
  }
}
