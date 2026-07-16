/**
 * Builtin slash commands per agent type. Static SDK-injected list — not user
 * configuration, not persisted on session row.
 */

import { type AgentType } from '../data/types/agent'
import { AGENT_RUNTIME_CAPABILITIES } from './agentRuntimeCapabilities'
import { type SlashCommand } from './slashCommands'

export function getBuiltinSlashCommands(agentType: AgentType | string | undefined): SlashCommand[] {
  if (!agentType || !(agentType in AGENT_RUNTIME_CAPABILITIES)) return []
  return [...AGENT_RUNTIME_CAPABILITIES[agentType as AgentType].slashCommands]
}
