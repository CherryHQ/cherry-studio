/**
 * Filter that gates the model picker shown to an agent.
 *
 * `claude-code` agents run via the Anthropic Agent SDK. Native Anthropic-shaped
 * providers still run directly; other chat models are routed through the local
 * API Gateway's Anthropic-compatible `/v1/messages` surface at runtime.
 *
 * Default `null`-typed agents fall through to the shared "agent-friendly"
 * filter (drops embedding / rerank / image-generation models — none of
 * those make sense as chat targets).
 */

import { useProviders } from '@renderer/hooks/useProvider'
import type { AgentType } from '@shared/data/types/agent'
import type { Model } from '@shared/data/types/model'
import { isAgentRuntimeSupportedModel, isNonChatModel } from '@shared/utils/model'
import { useCallback, useMemo } from 'react'

const baseAgentFilter = (model: Model): boolean => !isNonChatModel(model)

/**
 * Returns a memoized `(model) => boolean` predicate that matches the agent's
 * runtime constraints. Pair with `<ModelSelector filter={...}>`.
 */
export function useAgentModelFilter(agentType: AgentType | undefined): (model: Model) => boolean {
  const { providers } = useProviders()

  const providersById = useMemo(() => new Map(providers.map((provider) => [provider.id, provider])), [providers])

  return useCallback(
    (model: Model) => {
      if (agentType === 'claude-code') {
        return isAgentRuntimeSupportedModel(model, providersById.get(model.providerId))
      }
      return baseAgentFilter(model)
    },
    [agentType, providersById]
  )
}
