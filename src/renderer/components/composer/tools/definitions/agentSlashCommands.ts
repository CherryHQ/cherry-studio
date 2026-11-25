import { AGENT_RUNTIME_CAPABILITIES } from '@shared/ai/agentRuntimeCapabilities'
import type { SlashCommand } from '@shared/ai/slashCommands'
import type { AgentType } from '@shared/data/types/agent'

/** Renderer fallback catalog used before a live runtime publishes its slash commands. */
export function getBuiltinSlashCommands(agentType: AgentType | string | undefined): SlashCommand[] {
  const runtime = Object.entries(AGENT_RUNTIME_CAPABILITIES).find(([type]) => type === agentType)?.[1]

  return runtime ? [...runtime.slashCommands] : []
}
