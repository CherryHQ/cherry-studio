import type { RuntimeCommand } from '@cherrystudio/agent-runtime'

export type AgentSessionSlashCommand = RuntimeCommand & { source?: 'offline' }

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
