import { AGENT_RUNTIME_CAPABILITIES } from '@shared/ai/agentRuntimeCapabilities'
import type { SlashCommand } from '@shared/ai/slashCommands'
import type { AgentType } from '@shared/data/types/agent'

/** Renderer fallback catalog used before a live runtime publishes its slash commands. */
export function getBuiltinSlashCommands(agentType: AgentType | string | undefined): SlashCommand[] {
  if (!agentType || !(agentType in AGENT_RUNTIME_CAPABILITIES)) return []
  return [...AGENT_RUNTIME_CAPABILITIES[agentType as AgentType].slashCommands]
}
