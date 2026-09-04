import { type AiPlugin, resolveLanguageModel } from '@cherrystudio/ai-core'
import type { ServingCredentialReceipt } from '@main/ai/provider/credential'
import { providerService } from '@main/data/services/ProviderService'
import type { CompactionSink } from '@shared/ai/compaction'
import type { Assistant } from '@shared/data/types/assistant'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import type { AiBaseRequest, AppProviderSettingsMap } from '../../../types'
import { buildAgentParams } from '../params/buildAgentParams'
import type { RequestFeature } from '../params/feature'
import type { FallbackResolver } from './createRetryableWrap'
import { resolveApiKeyFallbacks } from './resolveApiKeyFallbacks'

export interface BuildApiKeyFallbackModelsArgs {
  request: AiBaseRequest & { chatId?: string; messageId?: string; compactionSink?: CompactionSink }
  provider: Provider
  model: Model
  assistant: Assistant | undefined
  signal: AbortSignal | undefined
  extraFeatures: readonly RequestFeature[]
  primaryCredentialReceipt: ServingCredentialReceipt
  createUsagePlugin: (credentialReceipt: ServingCredentialReceipt) => AiPlugin
}

/** Lazily builds the same provider/model with each remaining enabled key. */
export function buildApiKeyFallbackModels(args: BuildApiKeyFallbackModelsArgs): FallbackResolver[] {
  if (args.request.apiKeyOverride !== undefined || !('id' in args.primaryCredentialReceipt)) return []
  const keys = resolveApiKeyFallbacks(
    providerService.getApiKeys(args.provider.id, { enabled: true }),
    args.primaryCredentialReceipt
  )
  return keys.map((key) => async () => {
    const repairUsagePlugins: { current?: AiPlugin[] } = {}
    const built = await buildAgentParams({
      request: { ...args.request, apiKeyOverride: key.key },
      signal: args.signal,
      provider: args.provider,
      model: args.model,
      assistant: args.assistant,
      extraFeatures: args.extraFeatures,
      getRepairUsagePlugins: () => repairUsagePlugins.current ?? [],
      compactionSink: args.request.compactionSink
    })
    const usagePlugin = args.createUsagePlugin(built.credentialReceipt)
    repairUsagePlugins.current = [usagePlugin]
    const resolved = await resolveLanguageModel<AppProviderSettingsMap>(
      built.sdkConfig.providerId,
      built.sdkConfig.providerSettings,
      built.sdkConfig.modelId,
      [...built.plugins, usagePlugin]
    )
    return { model: resolved }
  })
}
