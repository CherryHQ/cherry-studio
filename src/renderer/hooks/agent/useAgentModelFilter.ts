/**
 * Filter that gates the model picker shown to an agent.
 *
 * `claude-code` agents run via the Anthropic Agent SDK. Native
 * Anthropic-shaped providers still run directly; other chat models are routed
 * through the local API Gateway's Anthropic-compatible `/v1/messages` surface
 * at runtime.
 *
 * The selector should only drop model classes that cannot act as chat targets.
 */

import type { AgentType } from '@shared/data/types/agent'
import type { Model } from '@shared/data/types/model'
import { isNonChatModel } from '@shared/utils/model'
import { useCallback } from 'react'

const baseAgentFilter = (model: Model): boolean => !isNonChatModel(model)
const agentFilters: Record<AgentType, (model: Model) => boolean> = {
  'claude-code': baseAgentFilter
}

/**
 * Returns a memoized `(model) => boolean` predicate that matches the agent's
 * runtime constraints. Pair with `<ModelSelector filter={...}>`.
 */
export function useAgentModelFilter(agentType: AgentType | undefined): (model: Model) => boolean {
  const filter = agentType ? agentFilters[agentType] : baseAgentFilter
  return useCallback(filter, [filter])
}
