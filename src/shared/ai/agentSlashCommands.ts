/**
 * Builtin slash commands per agent type. Static SDK-injected list — not user
 * configuration, not persisted on session row.
 */

import { type AgentType } from '../data/types/agent'
import { type SlashCommand } from './slashCommands'

// Fallback shown only until the runtime reports the session's real catalog via
// `query.supportedCommands()`. Keep it to current Claude Code built-ins (see
// https://code.claude.com/docs/en/commands) — `/todos` was never a built-in and `/cost` is now
// only an alias of `/usage`, so neither belongs here.
const CLAUDE_CODE_BUILTIN_COMMANDS: SlashCommand[] = [
  { command: '/clear', description: 'Start a new conversation with empty context' },
  { command: '/compact', description: 'Free up context by summarizing the conversation so far' },
  { command: '/context', description: 'Visualize current context usage as a colored grid' },
  { command: '/usage', description: 'Show session cost, plan usage limits, and activity stats' }
]

export function getBuiltinSlashCommands(agentType: AgentType | string | undefined): SlashCommand[] {
  if (agentType === 'claude-code') return CLAUDE_CODE_BUILTIN_COMMANDS
  return []
}
