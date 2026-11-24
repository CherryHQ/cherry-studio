export const SLASH_COMMANDS = [
  { name: 'new', description: 'Start a new conversation' },
  { name: 'compact', description: 'Compact conversation history' },
  { name: 'help', description: 'Show available commands' },
  { name: 'whoami', description: 'Show chat info' },
  { name: 'topics', description: 'Show topic agent assignments' }
] as const

const COMMAND_REGEX = new RegExp(`^\\/(${SLASH_COMMANDS.map((c) => c.name).join('|')})\\b`)

export function isSlashCommand(text: string): boolean {
  return COMMAND_REGEX.test(text)
}
