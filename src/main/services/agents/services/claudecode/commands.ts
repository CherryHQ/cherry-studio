import type { SlashCommand } from '@types'

export const builtinSlashCommands: SlashCommand[] = [
  { command: '/clear', description: 'Clear conversation history' },
  { command: '/compact', description: 'Compact conversation with optional focus instructions' },
  { command: '/context', description: 'Visualize current context usage as a colored grid' },
  {
    command: '/cost',
    description: 'Show token usage statistics (see cost tracking guide for subscription-specific details)'
  },
  { command: '/todos', description: 'List current todo items' }
]
