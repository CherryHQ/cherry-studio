import { definePlugin } from '@cherrystudio/ai-core'
import { isQwenModel } from '@shared/utils/model'
import { isSupportEnableThinkingProvider } from '@shared/utils/provider'

import type { RequestFeature } from '../feature'

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
    scope.reasoning.kind !== 'omit' &&
    !scope.reasoning.emissions.some((e) => e.target === 'enable_thinking'),
  contributeModelAdapters: (scope) => [
    definePlugin({
      name: 'qwen-enable-thinking',
      enforce: 'pre',

      configureContext: (context) => {
        context.extensions.set('__qwenEnableThinkingKey', scope.sdkConfig.providerOptionsKey)
        context.extensions.set('__qwenEnableThinkingOn', scope.reasoning.kind !== 'off')
      },

      transformParams: (params, context) => {
        const key = context.extensions.get('__qwenEnableThinkingKey') as string | undefined
        const enabled = context.extensions.get('__qwenEnableThinkingOn') as boolean | undefined
        if (!key || enabled === undefined) return params

        const providerOptions = { ...params.providerOptions }
        providerOptions[key] = { ...providerOptions[key], enable_thinking: enabled }
        return { ...params, providerOptions }
      }
    })
  ]
}
