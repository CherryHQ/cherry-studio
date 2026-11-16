/**
 * Filter that gates the model picker shown to an agent.
 *
 * Each runtime contributes its compatibility predicate through the shared
 * capability matrix. Claude Code, Pi and Pi Durable use gateway routability;
 * Pi also excludes providers whose authentication requires an external CLI.
 *
 * Default `null`-typed agents fall through to the shared "agent-friendly"
 * filter (drops embedding / rerank / image-generation models — none of
 * those make sense as chat targets).
 */

import { useMemo } from 'react'

import { AGENT_RUNTIME_CAPABILITIES, getFreshAgentRuntimeType } from '@shared/ai/agentRuntimeCapabilities'
import type { AgentType } from '@shared/data/types/agent'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { isNonChatModel } from '@shared/utils/model'

const baseAgentFilter = (model: Model): boolean => !isNonChatModel(model)

type ModelPredicate = (model: Model, provider?: Provider) => boolean

/**
 * Session pickers honor pinned ownership; configuration pickers use the runtime
 * a candidate model would allocate. Pair with `<ModelSelector filter={...}>`.
 */
export function useAgentModelFilter(
  agentType: AgentType | undefined,
  scope: 'session' | 'configuration' = 'session'
): ModelPredicate {
  return useMemo<ModelPredicate>(() => {
    return (model, provider) => {
      if (!baseAgentFilter(model)) return false
      const runtimeType = scope === 'configuration' ? getFreshAgentRuntimeType(provider) : agentType
      const caps = runtimeType ? AGENT_RUNTIME_CAPABILITIES[runtimeType] : undefined
      return !caps?.isModelCompatible || caps.isModelCompatible(provider, model)
    }
  }, [agentType, scope])
}
