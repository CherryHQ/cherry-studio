import { useAgent } from '@renderer/hooks/agent/useAgent'
import type { AgentSessionSource } from '@renderer/hooks/agent/useSession'
import { useModelById } from '@renderer/hooks/useModel'
import { useProviderById } from '@renderer/hooks/useProvider'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { AgentEntity } from '@shared/data/types/agent'
import type { Model } from '@shared/data/types/model'
import { isUniqueModelId, parseUniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { useMemo } from 'react'

export interface AgentConversationResources {
  agent?: AgentEntity
  agentLoading: boolean
  model?: Model
  modelLoading: boolean
  provider?: Provider
  providerLoading: boolean
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
 * The list agent is only a key hint: it lets the model and provider requests start while the
 * canonical by-id agent query is still resolving. Once that query returns, its model id wins.
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
  const modelId = agent ? agent.model : hintedModelId
  const { model, isLoading: modelLoading } = useModelById(modelId)
  const providerId = isUniqueModelId(modelId) ? parseUniqueModelId(modelId).providerId : null
  const { provider, isLoading: providerLoading } = useProviderById(providerId)

  const resources = useMemo<AgentConversationResources>(
    () => ({ agent, agentLoading, model, modelLoading, provider, providerLoading }),
    [agent, agentLoading, model, modelLoading, provider, providerLoading]
  )

  return useMemo(
    () => ({ session, sessionLoading, sessionSource, resources }),
    [resources, session, sessionLoading, sessionSource]
  )
}
