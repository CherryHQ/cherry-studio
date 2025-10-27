import { SlashCommand } from '@types'

export const builtinSlashCommands: SlashCommand[] = [
  { command: '/add-dir', description: 'Add additional working directories' },
  { command: '/agents', description: 'Manage custom AI subagents for specialized tasks' },
  { command: '/bug', description: 'Report bugs (sends conversation to Anthropic)' },
  { command: '/clear', description: 'Clear conversation history' },
  { command: '/compact', description: 'Compact conversation with optional focus instructions' },
  { command: '/config', description: 'View/modify configuration' },
  { command: '/cost', description: 'Show token usage statistics' },
  { command: '/doctor', description: 'Checks the health of your Claude Code installation' },
  { command: '/help', description: 'Get usage help' },
  { command: '/init', description: 'Initialize project with CLAUDE.md guide' },
  { command: '/login', description: 'Switch Anthropic accounts' },
  { command: '/logout', description: 'Sign out from your Anthropic account' },
  { command: '/mcp', description: 'Manage MCP server connections and OAuth authentication' },
  { command: '/memory', description: 'Edit CLAUDE.md memory files' },
  { command: '/model', description: 'Select or change the AI model' },
  { command: '/permissions', description: 'View or update permissions' },
  { command: '/pr_comments', description: 'View pull request comments' },
  { command: '/review', description: 'Request code review' },
  { command: '/status', description: 'View account and system statuses' },
  { command: '/terminal-setup', description: 'Install Shift+Enter key binding for newlines (iTerm2 and VSCode only)' },
  { command: '/vim', description: 'Enter vim mode for alternating insert and command modes' }
]
