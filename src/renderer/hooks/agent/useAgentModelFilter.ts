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
import { isNonChatModel } from '@shared/utils/model'
import { isGeminiProvider } from '@shared/utils/provider'
import { useCallback, useMemo } from 'react'

const baseAgentFilter = (model: Model): boolean => !isNonChatModel(model)

/**
 * Returns a memoized `(model) => boolean` predicate that matches the agent's
 * runtime constraints. Pair with `<ModelSelector filter={...}>`.
 */
export function useAgentModelFilter(agentType: AgentType | undefined): (model: Model) => boolean {
  const { providers } = useProviders()

  const geminiProviderIds = useMemo(() => {
    const ids = new Set<string>()
    for (const provider of providers) {
      if (isGeminiProvider(provider)) {
        ids.add(provider.id)
      }
    }
    return ids
  }, [providers])

  return useCallback(
    (model: Model) => {
      if (!baseAgentFilter(model)) return false
      if (agentType === 'claude-code') {
        return !geminiProviderIds.has(model.providerId)
      }
      return true
    },
    [agentType, geminiProviderIds]
  )
}
