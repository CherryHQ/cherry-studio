export const SLASH_COMMANDS = [
  { name: 'new', description: 'Start a new conversation' },
  { name: 'compact', description: 'Compact conversation history' },
  { name: 'help', description: 'Show available commands' },
  { name: 'whoami', description: 'Show chat info' }
] as const

export function parseSlashCommand(text: string) {
  const token = text.split(/\s+/, 1)[0]

  return SLASH_COMMANDS.find(({ name }) => token === `/${name}`)?.name
}
