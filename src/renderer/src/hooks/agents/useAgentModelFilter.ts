/**
 * Filter that gates the model picker shown to an agent.
 *
 * `claude-code` agents run via the Anthropic Agent SDK against a provider's
 * `anthropic-messages` endpoint. Both the provider and the selected model must
 * be compatible: Claude Agent SDK's `model` option is a Claude model id, and
 * sending obvious OpenAI/Gemini/etc. models through this path fails later as an
 * upstream "unsupported operation" error.
 *
 * Default `null`-typed agents fall through to the shared "agent-friendly"
 * filter (drops embedding / rerank / image-generation models — none of
 * those make sense as chat targets).
 */

import { ENDPOINT_TYPE } from '@cherrystudio/provider-registry'
import { useProviders } from '@renderer/hooks/useProviders'
import type { AgentType } from '@shared/data/types/agent'
import type { Model } from '@shared/data/types/model'
import { isAnthropicModel, isNonChatModel } from '@shared/utils/model'
import { useCallback, useMemo } from 'react'

const NATIVE_ANTHROPIC_PROVIDER_IDS = new Set(['anthropic'])

const baseAgentFilter = (model: Model): boolean => !isNonChatModel(model)
const claudeAgentModelFilter = (model: Model): boolean =>
  isAnthropicModel(model) || model.endpointTypes?.includes(ENDPOINT_TYPE.ANTHROPIC_MESSAGES) === true

/**
 * Returns a memoized `(model) => boolean` predicate that matches the agent's
 * runtime constraints. Pair with `<ModelSelector filter={...}>`.
 */
export function useAgentModelFilter(agentType: AgentType | undefined): (model: Model) => boolean {
  const { providers } = useProviders()

  // Set of provider ids that can serve Anthropic-shaped requests — either the
  // native `anthropic` adapter or a provider with an explicit Anthropic
  // endpoint URL.
  const claudeCompatibleProviderIds = useMemo(() => {
    const ids = new Set<string>(NATIVE_ANTHROPIC_PROVIDER_IDS)
    for (const provider of providers) {
      if (provider.presetProviderId && NATIVE_ANTHROPIC_PROVIDER_IDS.has(provider.presetProviderId)) {
        ids.add(provider.id)
        continue
      }
      if (provider.endpointConfigs?.[ENDPOINT_TYPE.ANTHROPIC_MESSAGES]?.baseUrl) {
        ids.add(provider.id)
      }
    }
    return ids
  }, [providers])

  return useCallback(
    (model: Model) => {
      if (!baseAgentFilter(model)) return false
      if (agentType === 'claude-code') {
        return claudeCompatibleProviderIds.has(model.providerId) && claudeAgentModelFilter(model)
      }
      return true
    },
    [agentType, claudeCompatibleProviderIds]
  )
}
