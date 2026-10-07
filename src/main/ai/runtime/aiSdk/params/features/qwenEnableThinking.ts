import { definePlugin } from '@cherrystudio/ai-core'
import { isQwenModel } from '@shared/utils/model'
import { isSupportEnableThinkingProvider } from '@shared/utils/provider'

import type { RequestFeature } from '../feature'
import { resolveCallReasoning } from '../reasoningControl'
import { createRequestReasoningControl } from './reasoningControl'

/**
 * Inject `enable_thinking` into providerOptions for Qwen models on providers
 * that accept the parameter but have no registry wire profile for it
 * (e.g. user-configured vLLM / openai-compatible endpoints).
 *
 * Complement of `qwenThinkingFeature`: that feature handles providers that
 * do NOT support `enable_thinking` (Ollama, LMStudio, …) by appending
 * `/think` or `/no_think` to messages. This feature handles providers that
 * DO support `enable_thinking` but lack a registered wire profile.
 */
export const qwenEnableThinkingFeature: RequestFeature = {
  name: 'qwen-enable-thinking',
  applies: (scope) =>
    isQwenModel(scope.model) &&
    isSupportEnableThinkingProvider(scope.provider) &&
    !Object.values(scope.reasoningProfile.wire).some(
      (mode) => typeof mode === 'object' && mode.operations.some((operation) => operation.target === 'enable_thinking')
    ),
  contributeModelAdapters: (scope) => [
    definePlugin({
      name: 'qwen-enable-thinking',
      enforce: 'pre',

      configureContext: (context) => {
        const control = createRequestReasoningControl(scope)
        const key = scope.sdkConfig.providerOptionsKey
        context.middlewares ??= []
        context.middlewares.push({
          specificationVersion: 'v4',
          transformParams: async ({ params }) => {
            const reasoning = resolveCallReasoning(control, params)
            if (reasoning.kind === 'omit' || params.providerOptions?.[key]?.enable_thinking !== undefined) return params
            const effort = params.providerOptions?.[key]?.reasoningEffort
            return {
              ...params,
              providerOptions: {
                ...params.providerOptions,
                [key]: {
                  ...params.providerOptions?.[key],
                  enable_thinking: effort !== undefined ? effort !== 'none' : reasoning.kind !== 'off'
                }
              }
            }
          }
        })
      }
    })
  ]
}
