import type { ChatComposerDraftCache } from '@renderer/components/composer/variants/chat/chatDraftCache'
import type { AgentSessionWorkspaceSource } from '@shared/data/api/schemas/agentWorkspaces'

export type CreateAgentSessionDefaults = {
  handoffDraft?: ChatComposerDraftCache
  agentId?: string | null
  workspace?: AgentSessionWorkspaceSource
  workspaceId?: string
  workspaceMode?: 'system'
}
