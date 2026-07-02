/**
 * Filter that gates the model picker shown to an agent.
 *
 * `claude-code` agents run via the Anthropic Agent SDK. Native Anthropic-shaped
 * providers still run directly; other chat models are routed through the local
 * API Gateway's Anthropic-compatible `/v1/messages` surface at runtime.
 *
 * `pi` agents run through the pi harness, which speaks only the wire protocols
 * in `@shared/ai/piModelCompatibility` — filter to providers/models pi can
 * drive so incompatible models are never offered (D2).
 *
 * Default `null`-typed agents fall through to the shared "agent-friendly"
 * filter (drops embedding / rerank / image-generation models — none of
 * those make sense as chat targets).
 */

import { useProviders } from '@renderer/hooks/useProvider'
import { isPiCompatibleModel } from '@shared/ai/piModelCompatibility'
import type { AgentType } from '@shared/data/types/agent'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
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

  const providerById = useMemo(() => {
    const map = new Map<string, Provider>()
    for (const provider of providers) map.set(provider.id, provider)
    return map
  }, [providers])

  return useCallback(
    (model: Model) => {
      if (!baseAgentFilter(model)) return false
      if (agentType === 'claude-code') {
        return !geminiProviderIds.has(model.providerId)
      }
      if (agentType === 'pi') {
        const provider = providerById.get(model.providerId)
        return provider ? isPiCompatibleModel(provider, model) : false
      }
      return true
    },
    [agentType, geminiProviderIds, providerById]
  )
}
