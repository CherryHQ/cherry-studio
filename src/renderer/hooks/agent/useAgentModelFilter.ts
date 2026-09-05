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

import {
  type CherryCloudFreeQuotaStatus,
  useCherryCloudModelAvailability,
  useCherryCloudModelFilter
} from '@renderer/hooks/useCherryCloudModelAvailability'
import { AGENT_RUNTIME_CAPABILITIES } from '@shared/ai/agentRuntimeCapabilities'
import type { AgentType } from '@shared/data/types/agent'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { isNonChatModel } from '@shared/utils/model'
import { useMemo } from 'react'

const baseAgentFilter = (model: Model): boolean => !isNonChatModel(model)

type ModelPredicate = (model: Model, provider?: Provider) => boolean

type AgentModelAvailability = {
  getModelFreeQuotaStatus: (model: Model) => CherryCloudFreeQuotaStatus | undefined
  isModelExclusiveToAgent: (model: Model) => boolean
  isModelDisabled: ModelPredicate
}

/**
 * Returns a memoized `(model) => boolean` predicate that matches the agent's
 * runtime constraints. Pair with `<ModelSelector filter={...}>`.
 */
export function useAgentModelFilter(agentType: AgentType | undefined, enabled = true): ModelPredicate {
  const runtimeFilter = useMemo<ModelPredicate>(() => {
    const caps = agentType ? AGENT_RUNTIME_CAPABILITIES[agentType] : undefined
    return (model, provider) => {
      if (!baseAgentFilter(model)) return false
      return !caps?.isModelCompatible || caps.isModelCompatible(provider, model)
    }
  }, [agentType])

  return useCherryCloudModelFilter('agent', runtimeFilter, enabled)
}

/** Returns Cherry Cloud availability for model selectors in the Work module. */
export function useAgentModelAvailability(enabled = true): AgentModelAvailability {
  const { getModelFreeQuotaStatus, isModelDisabledForFeature, isModelExclusiveToFeature } =
    useCherryCloudModelAvailability(enabled)

  return useMemo(
    () => ({
      getModelFreeQuotaStatus,
      isModelExclusiveToAgent: (model: Model) => isModelExclusiveToFeature(model, 'agent'),
      isModelDisabled: (model: Model) => isModelDisabledForFeature(model, 'agent')
    }),
    [getModelFreeQuotaStatus, isModelDisabledForFeature, isModelExclusiveToFeature]
  )
}

/** Returns the Agent selector rule for models that stay visible but cannot be selected. */
export function useAgentModelDisabled(enabled = true): ModelPredicate {
  return useAgentModelAvailability(enabled).isModelDisabled
}
