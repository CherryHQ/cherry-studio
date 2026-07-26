import type { SlashCommand } from '@anthropic-ai/claude-agent-sdk'

// The driver returns the SDK's slash-command catalog verbatim (`query.supportedCommands()`), so
// alias the SDK type rather than hand-mirroring it — a shape change in the SDK surfaces at compile
// time instead of silently diverging the cached contract. `name` is the command without its leading
// slash (e.g. `clear`); consumers prepend `/` when rendering.
export type AgentSessionSlashCommand = SlashCommand

export const AGENT_SESSION_SLASH_COMMANDS_CACHE_KEY = (sessionId: string) =>
  `agent.session.slash_commands.${sessionId}` as const
