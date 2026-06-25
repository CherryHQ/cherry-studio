import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { AgentSessionWorkspaceSource, AgentWorkspaceEntity } from '@shared/data/api/schemas/agentWorkspaces'

export type DraftAgentWorkspacePreview = Pick<AgentWorkspaceEntity, 'type'> &
  Partial<Pick<AgentWorkspaceEntity, 'id' | 'name' | 'path'>>

export type DraftAgentSessionDefaults = {
  agentId?: string | null
  workspace?: AgentSessionWorkspaceSource
  workspaceId?: string
  workspaceMode?: 'system'
}

export type DraftAgentSession = {
  agentId: string
  workspaceSource: AgentSessionWorkspaceSource
  workspace?: DraftAgentWorkspacePreview
}

export type PersistentAgentSessionConversation = {
  sessionId: string
  topicId: string
  agentId: string
  name: string
  session: AgentSessionEntity
}

export type EnsurePersistentSession = (initialName?: string) => Promise<PersistentAgentSessionConversation | null>
