/**
 * Builtin slash commands per agent type. Static SDK-injected list — not user
 * configuration, not persisted on session row.
 */

import { type AgentType } from '../data/types/agent'
import { type SlashCommand } from './slashCommands'

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
