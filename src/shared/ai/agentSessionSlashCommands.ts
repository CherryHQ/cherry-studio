import type { SlashCommand } from '@anthropic-ai/claude-agent-sdk'

// The driver returns SDK slash-command entries after excluding commands owned by Cherry's composer
// UI. Keep the SDK type rather than hand-mirroring it so shape changes surface at compile time.
// `name` is the command without its leading slash (e.g. `clear`); consumers prepend `/` when rendering.
export type AgentSessionSlashCommand = SlashCommand

export const AGENT_SESSION_SLASH_COMMANDS_CACHE_KEY = (sessionId: string) =>
  `agent.session.slash_commands.${sessionId}` as const
