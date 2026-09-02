/**
 * Filter that gates the model picker shown to an agent.
 *
 * Each runtime contributes its compatibility predicate through the shared
 * capability matrix. Claude Code uses the API Gateway's routability predicate;
 * Pi additionally validates that its provider wire protocol is supported.
 *
 * Default `null`-typed agents fall through to the shared "agent-friendly"
 * filter (drops embedding / rerank / image-generation models — none of
 * those make sense as chat targets).
 */

import { useCherryCloudModelAvailability } from '@renderer/hooks/useCherryCloudModelAvailability'
import { AGENT_RUNTIME_CAPABILITIES } from '@shared/ai/agentRuntimeCapabilities'
import { CHERRY_CLOUD_MODEL_FEATURE } from '@shared/data/presets/cherryai'
import type { AgentType } from '@shared/data/types/agent'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { isNonChatModel } from '@shared/utils/model'
import { useMemo } from 'react'

const baseAgentFilter = (model: Model): boolean => !isNonChatModel(model)

type ModelPredicate = (model: Model, provider?: Provider) => boolean
const AGENT_ONLY_FILTER = Symbol('agentModelFilter')
type AgentModelFilter = ModelPredicate & { [AGENT_ONLY_FILTER]?: true }

/** True when `filter` came from an Agent picker that may include Agent-only providers. */
export function modelFilterIncludesAgentOnlyProviders(filter?: ModelPredicate): boolean {
  return Boolean((filter as AgentModelFilter | undefined)?.[AGENT_ONLY_FILTER])
}

/**
 * Returns a memoized `(model) => boolean` predicate that matches the agent's
 * runtime constraints. Pair with `<ModelSelector filter={...}>`.
 */
export function useAgentModelFilter(agentType: AgentType | undefined): AgentModelFilter {
  const { isModelAvailableForFeature } = useCherryCloudModelAvailability()
  return useMemo<AgentModelFilter>(() => {
    const caps = agentType ? AGENT_RUNTIME_CAPABILITIES[agentType] : undefined
    const predicate: AgentModelFilter = (model, provider) => {
      if (!baseAgentFilter(model)) return false
      if (!isModelAvailableForFeature(model, CHERRY_CLOUD_MODEL_FEATURE.AGENT)) return false
      return !caps?.isModelCompatible || caps.isModelCompatible(provider, model)
    }
    predicate[AGENT_ONLY_FILTER] = true
    return predicate
  }, [agentType, isModelAvailableForFeature])
}

/** Returns the Agent selector rule for models that stay visible but cannot be selected. */
export function useAgentModelDisabled(): ModelPredicate {
  return useCherryCloudModelAvailability().isModelDisabled
}
