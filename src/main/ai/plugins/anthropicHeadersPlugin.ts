/**
 * Anthropic `anthropic-beta` header plugin.
 *
 * Sets `params.headers['anthropic-beta']` to the comma-joined list of beta
 * flag names returned by `addAnthropicHeaders`, for Anthropic-DIRECT requests
 * only (Bedrock handles beta flags via `providerOptions.bedrock.anthropicBeta`
 * — see `buildBedrockProviderOptions` in `utils/options.ts`; Vertex may or
 * may not apply here depending on the specific flag).
 *
 * Kept separate from `anthropicCachePlugin` because the two gate on
 * orthogonal conditions:
 *   - `anthropicCachePlugin` fires on `provider.settings.cacheControl.enabled`.
 *   - This plugin fires on model / tool-use / web-search capabilities.
 *   A user can opt into one without the other, so the plugins stay standalone.
 *
 * Enforce = 'pre' — headers are static once model / provider are resolved.
 */

import { type AiPlugin, definePlugin, type StreamTextParams, type StreamTextResult } from '@cherrystudio/ai-core'
import type { Assistant } from '@shared/data/types/assistant'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import { addAnthropicHeaders } from '../utils/anthropicHeaders'

export interface AnthropicHeadersPluginConfig {
  assistant: Assistant
  model: Model
  provider: Provider
}

export const createAnthropicHeadersPlugin = ({
  assistant,
  model,
  provider
}: AnthropicHeadersPluginConfig): AiPlugin<StreamTextParams, StreamTextResult> =>
  definePlugin<StreamTextParams, StreamTextResult>({
    name: 'anthropic-headers',
    enforce: 'pre',
    transformParams: (params) => {
      const betas = addAnthropicHeaders(assistant, model, provider)
      if (betas.length === 0) return {}

      const existingHeaders = (params.headers ?? {}) as Record<string, string>
      return {
        headers: {
          ...existingHeaders,
          'anthropic-beta': betas.join(',')
        }
      } as Partial<StreamTextParams>
    }
  })
