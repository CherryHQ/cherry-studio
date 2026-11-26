import type { LanguageModelMiddleware } from 'ai'

import { definePlugin } from '@cherrystudio/ai-core'
import { hasAnthropicThinkingCredential } from '@main/ai/messages/anthropicThinking'

import type { RequestFeature } from '../feature'

const preservedThinkingModel = /^claude-(?:(?:opus|sonnet|haiku)-5-5|(?:fable|mythos)-5-[12])(?:-\d{8})?$/

const middleware: LanguageModelMiddleware = {
  specificationVersion: 'v3',
  transformParams: async ({ params }) => {
    const anthropic = params.providerOptions?.anthropic
    const thinking = anthropic?.thinking
    if (thinking !== undefined) {
      if (thinking === null || typeof thinking !== 'object' || Array.isArray(thinking)) return params
      if (thinking.type !== 'adaptive' || thinking.blockBinding !== undefined) return params
    }
    const replaysThinking = params.prompt.some(
      (message) =>
        message.role === 'assistant' &&
        message.content.some(
          (part) => part.type === 'reasoning' && hasAnthropicThinkingCredential(part.providerOptions)
        )
    )
    if (!replaysThinking || anthropic?.sendReasoning === false) return params
    return {
      ...params,
      providerOptions: {
        ...params.providerOptions,
        anthropic: {
          ...anthropic,
          thinking: { ...thinking, type: 'adaptive', blockBinding: { prefixMismatchBehavior: 'drop_block' } }
        }
      }
    }
  }
}

const plugin = definePlugin({
  name: 'anthropic-thinking-binding',
  enforce: 'pre',
  configureContext: (context) => {
    context.middlewares ??= []
    context.middlewares.push(middleware)
  }
})

export const anthropicThinkingBindingFeature: RequestFeature = {
  name: plugin.name,
  applies: ({ request, sdkConfig }) => {
    if (
      request.contextOwner === 'caller' ||
      sdkConfig.providerId !== 'anthropic' ||
      !preservedThinkingModel.test(sdkConfig.modelId)
    )
      return false
    const settings = sdkConfig.providerSettings
    return (
      'baseURL' in settings &&
      typeof settings.baseURL === 'string' &&
      URL.parse(settings.baseURL)?.origin === 'https://api.anthropic.com'
    )
  },
  contributeModelAdapters: () => [plugin]
}
