/**
 * Sets `anthropic-beta` for Anthropic-DIRECT requests (Bedrock handles
 * beta flags via `providerOptions.bedrock.anthropicBeta`).
 */

import { type AiPlugin, definePlugin, type StreamTextParams, type StreamTextResult } from '@cherrystudio/ai-core'
import type { Assistant } from '@shared/data/types/assistant'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import { addAnthropicHeaders } from '../../../../utils/anthropicHeaders'

export interface AnthropicHeadersPluginConfig {
  assistant: Assistant
  model: Model
  provider: Provider
}

const createAnthropicHeadersPlugin = ({
  assistant,
  model,
  provider
}: AnthropicHeadersPluginConfig): AiPlugin<StreamTextParams, StreamTextResult> =>
  definePlugin<StreamTextParams, StreamTextResult>({
    name: 'anthropic-headers',
    enforce: 'pre',
    transformParams: (params) => {
      const betas = addAnthropicHeaders(assistant, model, provider)
      if (betas.length === 0) return params

      const existingHeaders = (params.headers ?? {}) as Record<string, string>
      return {
        ...params,
        headers: {
          ...existingHeaders,
          'anthropic-beta': betas.join(',')
        }
      }
    }
  })

import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { isAnthropicModel } from '@shared/utils/model'

import type { RequestFeature } from '../feature'

export const anthropicHeadersFeature: RequestFeature = {
  name: 'anthropic-headers',
  applies: (scope) =>
    Boolean(scope.assistant) &&
    isAnthropicModel(scope.model) &&
    scope.endpointType === ENDPOINT_TYPE.ANTHROPIC_MESSAGES &&
    scope.aiSdkProviderId !== 'bedrock',
  contributeModelAdapters: (scope) => [
    createAnthropicHeadersPlugin({ assistant: scope.assistant!, model: scope.model, provider: scope.provider })
  ]
}
