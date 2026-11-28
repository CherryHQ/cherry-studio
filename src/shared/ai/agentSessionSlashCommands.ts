import type { SlashCommand } from '@anthropic-ai/claude-agent-sdk'

import type { SlashCommand as CatalogCommand } from './slashCommands'

// The driver returns SDK slash-command entries after excluding commands owned by Cherry's composer
// UI. Keep the SDK type rather than hand-mirroring it so shape changes surface at compile time.
// `name` is the command without its leading slash (e.g. `clear`); consumers prepend `/` when rendering.
export type AgentSessionSlashCommand = SlashCommand &
  Pick<CatalogCommand, 'subcommands'> & { aliases?: readonly string[]; source?: 'offline' }

export interface AgentCommandIntent {
  name: string
  textName: string
  generation?: string
}

export const AGENT_SESSION_SLASH_COMMANDS_CACHE_KEY = (sessionId: string) =>
  `agent.session.slash_commands.${sessionId}` as const

export function parseAgentSlashCommand(text: string) {
  const match = /^\/(\S+)(?:\s+([\s\S]+))?$/.exec(text.trim())
  return match && { name: match[1], args: match[2]?.trim() ?? '' }
}
