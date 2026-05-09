/**
 * Filter that gates the model picker shown to an agent.
 *
 * `claude-code` agents run via the Anthropic Agent SDK against a provider's
 * `anthropic-messages` endpoint. The gate is **provider-level**, not
 * model-level: any model exposed by a provider that serves Anthropic-shape
 * requests is fine — the provider's `anthropic-messages` proxy may route to
 * Qwen / GLM / Claude / whatever underneath (siliconflow, deepseek, bigmodel,
 * aihubmix etc. all do this). Filtering by model name (e.g. requiring
 * "claude" in the name) hides those models incorrectly.
 *
 * Default `null`-typed agents fall through to the shared "agent-friendly"
 * filter (drops embedding / rerank / image-generation models — none of
 * those make sense as chat targets).
 */

import { ENDPOINT_TYPE } from '@cherrystudio/provider-registry'
import { useProviders } from '@renderer/hooks/useProviders'
import type { AgentType } from '@shared/data/types/agent'
import type { Model } from '@shared/data/types/model'
import { isNonChatModel } from '@shared/utils/model'
import { useCallback, useMemo } from 'react'

const NATIVE_ANTHROPIC_PROVIDER_IDS = new Set(['anthropic'])

const baseAgentFilter = (model: Model): boolean => !isNonChatModel(model)

/**
 * Returns a memoized `(model) => boolean` predicate that matches the agent's
 * runtime constraints. Pair with `<ModelSelector filter={...}>`.
 */
export function useAgentModelFilter(agentType: AgentType | undefined): (model: Model) => boolean {
  const { providers } = useProviders()

  // Set of provider ids that can serve Anthropic-shaped requests — either the
  // native `anthropic` adapter or a provider with an explicit
  // `endpointConfigs['anthropic-messages']` entry.
  const claudeCompatibleProviderIds = useMemo(() => {
    const ids = new Set<string>(NATIVE_ANTHROPIC_PROVIDER_IDS)
    for (const provider of providers) {
      if (provider.endpointConfigs?.[ENDPOINT_TYPE.ANTHROPIC_MESSAGES]) {
        ids.add(provider.id)
      }
    }
    return ids
  }, [providers])

  return useCallback(
    (model: Model) => {
      if (!baseAgentFilter(model)) return false
      if (agentType === 'claude-code') {
        return claudeCompatibleProviderIds.has(model.providerId)
      }
      return true
    },
    [agentType, claudeCompatibleProviderIds]
  )
}
