import { useMemo } from 'react'

import { useAgent } from '@renderer/hooks/agent/useAgent'
import type { AgentSessionSource } from '@renderer/hooks/agent/useSession'
import { useModelById } from '@renderer/hooks/useModel'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { AgentEntity } from '@shared/data/types/agent'
import type { Model } from '@shared/data/types/model'

export interface AgentConversationResources {
  agent?: AgentEntity
  agentLoading: boolean
  model?: Model
  modelLoading: boolean
}

export interface AgentConversationBootstrap {
  session: AgentSessionEntity | null
  sessionLoading: boolean
  sessionSource: AgentSessionSource
  resources: AgentConversationResources
}

interface UseAgentConversationBootstrapOptions {
  session: AgentSessionEntity | null
  sessionLoading: boolean
  sessionSource: AgentSessionSource
  agentHint?: Pick<AgentEntity, 'id' | 'model'>
}

/**
 * Page-owned read model for the active agent conversation.
 *
 * The list agent is only a key hint: it lets the model request start while the canonical by-id
 * agent query is still resolving. A per-session override wins first; once the
 * agent query returns, its model is the fallback.
 */
export function useAgentConversationBootstrap({
  session,
  sessionLoading,
  sessionSource,
  agentHint
}: UseAgentConversationBootstrapOptions): AgentConversationBootstrap {
  const agentId = session?.agentId ?? null
  const { agent, isLoading: agentLoading } = useAgent(agentId)
  const hintedModelId = agentHint?.id === agentId ? agentHint.model : undefined
  // The list hint only covers the agent query's loading window: once it resolves,
  // its value wins even when null, so a model-less agent never revives the hint.
  const modelId = session?.model ?? (agent ? agent.model : agentLoading ? hintedModelId : undefined)
  const { model, isLoading: modelLoading } = useModelById(modelId)

  const resources = useMemo<AgentConversationResources>(
    () => ({ agent, agentLoading, model, modelLoading }),
    [agent, agentLoading, model, modelLoading]
  )

  return useMemo(
    () => ({ session, sessionLoading, sessionSource, resources }),
    [resources, session, sessionLoading, sessionSource]
  )
}
