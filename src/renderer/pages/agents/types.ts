import type { AgentSessionWorkspaceSource } from '@shared/data/api/schemas/agentWorkspaces'

export type CreateAgentSessionDefaults = {
  agentId?: string | null
  workspace?: AgentSessionWorkspaceSource
  workspaceId?: string
  workspaceMode?: 'system'
  // Id of a session being replaced (post-delete): excluded from empty-session reuse so a stale
  // candidate list can't reactivate the just-deleted session instead of creating a fresh one.
  excludeReuseSessionId?: string
}
