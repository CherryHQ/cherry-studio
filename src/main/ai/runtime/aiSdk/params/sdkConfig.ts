/**
 * Provider/endpoint/model SDK-config resolution shared by the chat parameter
 * pipeline (`buildAgentParams`) and the AI SDK agent runtime
 * (`runtime/aiSdkAgent`). Kept below both so neither imports the other's
 * request shaping.
 */

import { application } from '@application'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import { createHttpTraceFetch } from '../../../observability'
import { providerToAiSdkConfig } from '../../../provider/config'
import type { SdkConfig } from './scope'

export async function resolveSdkConfig(provider: Provider, model: Model, apiKeyOverride?: string): Promise<SdkConfig> {
  return {
    ...(await providerToAiSdkConfig(provider, model, { apiKeyOverride })),
    modelId: model.apiModelId ?? model.id
  }
}

export function applyHttpTrace(sdkConfig: SdkConfig, topicId: string | undefined, model: Model): void {
  if (!application.get('PreferenceService').get('app.developer_mode.enabled')) return
  const settings = sdkConfig.providerSettings
  settings.fetch = createHttpTraceFetch(settings.fetch ?? globalThis.fetch, {
    topicId,
    modelName: model.name ?? model.id
  })
}
