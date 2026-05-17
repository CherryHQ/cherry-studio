/**
 * Builtin slash commands per agent type. Static SDK-injected list — not user
 * configuration, not persisted on session row.
 */

import { type SlashCommand } from '../api/schemas/agents'

export type AgentType = 'claude-code'

const CLAUDE_CODE_BUILTIN_COMMANDS: SlashCommand[] = [
  { command: '/clear', description: 'Clear conversation history' },
  { command: '/compact', description: 'Compact conversation with optional focus instructions' },
  { command: '/context', description: 'Visualize current context usage as a colored grid' },
  {
    command: '/cost',
    description: 'Show token usage statistics (see cost tracking guide for subscription-specific details)'
  },
  { command: '/todos', description: 'List current todo items' }
]

export function getBuiltinSlashCommands(agentType: AgentType | string | undefined): SlashCommand[] {
  if (agentType === 'claude-code') return CLAUDE_CODE_BUILTIN_COMMANDS
  return []
}
