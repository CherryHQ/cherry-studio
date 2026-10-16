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

import { useMemo } from 'react'

import { AGENT_RUNTIME_CAPABILITIES } from '@shared/ai/agentRuntimeCapabilities'
import type { AgentType } from '@shared/data/types/agent'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { isNonChatModel } from '@shared/utils/model'

const baseAgentFilter = (model: Model): boolean => !isNonChatModel(model)

type ModelPredicate = (model: Model, provider?: Provider) => boolean

/**
 * Returns a memoized `(model) => boolean` predicate that matches the agent's
 * runtime constraints. Pair with `<ModelSelector filter={...}>`.
 */
export function useAgentModelFilter(agentType: AgentType | undefined): ModelPredicate {
  return useMemo<ModelPredicate>(() => {
    const caps = agentType ? AGENT_RUNTIME_CAPABILITIES[agentType] : undefined
    return (model, provider) => {
      if (!baseAgentFilter(model)) return false
      return !caps?.isModelCompatible || caps.isModelCompatible(provider, model)
    }
  }, [agentType])
}
