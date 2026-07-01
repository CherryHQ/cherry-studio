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
import { isAgentRuntimeSupportedModel, isNonChatModel } from '@shared/utils/model'
import { useMemo } from 'react'

const baseAgentFilter = (model: Model): boolean => !isNonChatModel(model)

/**
 * Marks a model filter as an *agent* picker, which is allowed to surface
 * agent-only providers (e.g. `claude-code`). General/chat selectors leave their
 * filter unmarked, so `useModelSelectorData` hides those providers from them.
 */
const AGENT_ONLY_FILTER = Symbol('agentModelFilter')

type AgentModelFilter = ((model: Model) => boolean) & { [AGENT_ONLY_FILTER]?: true }

/** True when `filter` came from {@link useAgentModelFilter} (may include agent-only providers). */
export function modelFilterIncludesAgentOnlyProviders(filter?: (model: Model) => boolean): boolean {
  return Boolean((filter as AgentModelFilter | undefined)?.[AGENT_ONLY_FILTER])
}

/**
 * Returns a memoized `(model) => boolean` predicate that matches the agent's
 * runtime constraints. Pair with `<ModelSelector filter={...}>`.
 */
export function useAgentModelFilter(agentType: AgentType | undefined): (model: Model) => boolean {
  const { providers } = useProviders()

  const providersById = useMemo(() => new Map(providers.map((provider) => [provider.id, provider])), [providers])

  return useMemo<AgentModelFilter>(() => {
    const predicate: AgentModelFilter = (model: Model) => {
      if (!baseAgentFilter(model)) return false
      if (agentType === 'claude-code') {
        return isAgentRuntimeSupportedModel(model, providersById.get(model.providerId))
      }
      if (agentType === 'pi') {
        const provider = providersById.get(model.providerId)
        return provider ? isPiCompatibleModel(provider, model) : false
      }
      return true
    }
    predicate[AGENT_ONLY_FILTER] = true
    return predicate
  }, [agentType, providersById])
}
