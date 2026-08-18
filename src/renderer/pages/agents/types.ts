import type { AgentSessionWorkspaceSource } from '@shared/data/api/schemas/agentWorkspaces'

export type CreateAgentSessionDefaults = {
  agentId?: string | null
  workspace?: AgentSessionWorkspaceSource
  workspaceId?: string
  workspaceMode?: 'system'
}
