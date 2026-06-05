import type { ProviderOptions } from '@ai-sdk/provider-utils'
import { definePlugin } from '@cherrystudio/ai-core'
import type { ToolChoice, ToolSet } from 'ai'

import type { RequestFeature } from '../runtime/aiSdk/params/feature'

/**
 * Per-request overrides an API-gateway request needs the model to honor:
 * sampling params, client-supplied tools, and provider-specific options
 * (thinking / reasoning). These normally come from an assistant; the gateway
 * has none, so it supplies them per request.
 *
 * `tools` are client tool *definitions* with no `execute` — the model emits
 * the tool call and the gateway forwards it to the client, which executes it.
 */
export interface GatewayRequestOverrides {
  temperature?: number
  maxOutputTokens?: number
  topP?: number
  topK?: number
  stopSequences?: string[]
  tools?: ToolSet
  toolChoice?: ToolChoice<ToolSet>
  providerOptions?: ProviderOptions
}

/** Shallow per-provider merge so override providerOptions augment, not clobber. */
function mergeProviderOptions(base: ProviderOptions | undefined, extra: ProviderOptions): ProviderOptions {
  const out: ProviderOptions = { ...base }
  for (const [providerId, options] of Object.entries(extra)) {
    out[providerId] = { ...out[providerId], ...options }
  }
  return out
}

/**
 * Builds an additive {@link RequestFeature} that injects gateway per-request
 * params into the SDK call via a plugin's `transformParams`. This lets the
 * assistant-agnostic API gateway honor a client's temperature / max_tokens /
 * tools / thinking config WITHOUT changing the core request pipeline — it is
 * the same extension mechanism the built-in features use.
 *
 * Lives in `src/main/ai` so the `apiGateway` layer can build it without ever
 * importing `@cherrystudio/ai-core` itself.
 */
export function createGatewayOverrideFeature(overrides: GatewayRequestOverrides): RequestFeature {
  return {
    name: 'gateway-override',
    contributeModelAdapters: () => [
      definePlugin({
        name: 'gateway-override',
        // Apply last so explicit client params win over assistant/model defaults.
        enforce: 'post',
        transformParams: async (params: any) => {
          if (overrides.temperature !== undefined) params.temperature = overrides.temperature
          if (overrides.maxOutputTokens !== undefined) params.maxOutputTokens = overrides.maxOutputTokens
          if (overrides.topP !== undefined) params.topP = overrides.topP
          if (overrides.topK !== undefined) params.topK = overrides.topK
          if (overrides.stopSequences !== undefined) params.stopSequences = overrides.stopSequences
          if (overrides.tools) params.tools = { ...params.tools, ...overrides.tools }
          if (overrides.toolChoice !== undefined) params.toolChoice = overrides.toolChoice
          if (overrides.providerOptions) {
            params.providerOptions = mergeProviderOptions(params.providerOptions, overrides.providerOptions)
          }
          return params
        }
      })
    ]
  }
}
