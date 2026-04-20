/**
 * Custom-parameters plugin (user-input driven).
 *
 * Reads `assistant.settings.customParameters` (a typed discriminated union of
 * user-defined model parameters), splits it into:
 *
 *   - AI SDK standard params (`topK` / `frequencyPenalty` / `presencePenalty`
 *     / `stopSequences` / `seed`) → applied to `params` root.
 *   - Provider-scoped params → merged into `params.providerOptions[providerId]`
 *     using the Case 1/2/3 routing in `mergeCustomProviderParameters`.
 *
 * Layers on top of the capability-driven `providerOptions` that
 * `AiService.buildAgentParams` writes at agent creation time (flows via
 * `agentSettings.providerOptions` → into streamText params), plus any other
 * plugins that touched `params.providerOptions` upstream
 * (`anthropicCachePlugin` / `qwenThinkingPlugin` / etc.).
 *
 * Enforce = 'pre' — same phase as the other capability plugins; ordering
 * within phase is by `plugins.push` order in `PluginBuilder`.
 */

import { type AiPlugin, definePlugin, type StreamTextParams, type StreamTextResult } from '@cherrystudio/ai-core'
import type { Assistant } from '@shared/data/types/assistant'
import type { Provider } from '@shared/data/types/provider'

import { getAiSdkProviderId } from '../provider/factory'
import { extractAiSdkStandardParams, mergeCustomProviderParameters } from '../utils/options'
import { getCustomParameters } from '../utils/reasoning'

export interface CustomParametersPluginConfig {
  assistant: Assistant
  provider: Provider
}

export const createCustomParametersPlugin = ({
  assistant,
  provider
}: CustomParametersPluginConfig): AiPlugin<StreamTextParams, StreamTextResult> =>
  definePlugin<StreamTextParams, StreamTextResult>({
    name: 'custom-parameters',
    enforce: 'pre',
    transformParams: (params) => {
      const customParams = getCustomParameters(assistant)
      if (Object.keys(customParams).length === 0) return {}

      const { standardParams, providerParams } = extractAiSdkStandardParams(customParams)
      const rawProviderId = getAiSdkProviderId(provider)
      const existingProviderOptions =
        (params.providerOptions as Record<string, Record<string, unknown>> | undefined) ?? {}

      const mergedProviderOptions = mergeCustomProviderParameters(
        existingProviderOptions as Record<string, Record<string, never>>,
        providerParams,
        rawProviderId
      )

      return {
        ...standardParams,
        providerOptions: mergedProviderOptions
      } as Partial<StreamTextParams>
    }
  })
