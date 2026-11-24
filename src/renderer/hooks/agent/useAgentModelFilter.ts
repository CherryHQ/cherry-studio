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

import { isAgentModelSelectable } from '@shared/ai/agentRuntimeCapabilities'
import type { AgentType } from '@shared/data/types/agent'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

type ModelPredicate = (model: Model, provider?: Provider) => boolean

/**
 * Returns a memoized `(model) => boolean` predicate that matches the agent's
 * runtime constraints. Pair with `<ModelSelector filter={...}>`.
 */
export function useAgentModelFilter(agentType: AgentType | undefined): ModelPredicate {
  return useMemo<ModelPredicate>(
    () => (model, provider) => isAgentModelSelectable(agentType, model, provider),
    [agentType]
  )
}
