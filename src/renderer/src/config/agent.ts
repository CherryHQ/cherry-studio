import { AgentConfiguration } from '@renderer/types'

// base agent config. no default config for now.
const DEFAULT_AGENT_CONFIG: Omit<AgentConfiguration, 'model'> = {} as const

// no default config for now.
export const DEFAULT_CLAUDE_CODE_CONFIG: Omit<AgentConfiguration, 'model'> = {
  ...DEFAULT_AGENT_CONFIG
} as const
