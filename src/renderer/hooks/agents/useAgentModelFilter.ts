/**
 * Filter that gates the model picker shown to an agent.
 *
 * `claude-code` agents now also require function-calling capability on top of
 * the existing provider-level Anthropic-compatibility gate. The gate is
 * **provider-level**, not model-level: any model exposed by a provider that
 * serves Anthropic-shaped requests is fine — the provider's `anthropic-messages`
 * proxy may route to Qwen / GLM / Claude / Gemini / GPT / whatever underneath
 * (siliconflow, deepseek, bigmodel, aihubmix, cherryin etc. all do this).
 *
 * The API Gateway (proxyStream) handles cross-format protocol translation at
 * runtime via the adapter system (AnthropicMessageConverter → AI SDK →
 * AiSdkToAnthropicSse), so the model itself does NOT need to natively speak
 * Anthropic. See #14873 for the full protocol translation layer spec.
 *
 * Non-claude-code agents stay permissive (any chat-capable model) for backward
 * compatibility. The editor filter (BasicSection.tsx) enforces strict model
 * selection at agent creation time.
 */

import { ENDPOINT_TYPE } from '@cherrystudio/provider-registry'
import { useProviders } from '@renderer/hooks/useProvider'
import type { AgentType } from '@shared/data/types/agent'
import type { Model } from '@shared/data/types/model'
import { isFunctionCallingModel, isNonChatModel } from '@shared/utils/model'
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
        return (
          claudeCompatibleProviderIds.has(model.providerId) &&
          isFunctionCallingModel(model)
        )
      }
      // Non-claude-code agents: keep permissive behavior for backward compat.
      // The editor filter (BasicSection.tsx) enforces strict model selection
      // at creation time; runtime allows any chat-capable model.
      return true
    },
    [agentType, claudeCompatibleProviderIds]
  )
}
