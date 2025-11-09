import type { SlashCommand } from '@types'

export const builtinSlashCommands: SlashCommand[] = [
  { command: '/clear', description: 'Clear conversation history' },
  { command: '/compact', description: 'Compact conversation with optional focus instructions' }
]
