import type { LanguageModelMiddleware } from 'ai'

import { definePlugin } from '@cherrystudio/ai-core'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { matchesPreset } from '@shared/utils/provider'

import type { RequestFeature } from '../feature'

const CLIENT_IDENTIFIER = 'x-anthropic-billing-header: cc_entrypoint=cli;'

/** Qwen requires its documented client identifier in the system body for native Anthropic web tools. */
export function createQwenAnthropicWebToolsMiddleware(): LanguageModelMiddleware {
  return {
    specificationVersion: 'v3',
    transformParams: async ({ params }) => {
      const hasWebTool = params.tools?.some(
        (tool) => tool.type === 'provider' && /^anthropic\.web_(search|fetch)_\d+$/.test(tool.id)
      )
      if (
        !hasWebTool ||
        params.prompt.some((message) => message.role === 'system' && message.content.includes(CLIENT_IDENTIFIER))
      ) {
        return params
      }
      return { ...params, prompt: [{ role: 'system', content: CLIENT_IDENTIFIER }, ...params.prompt] }
    }
  }
}

export const qwenAnthropicWebToolsFeature: RequestFeature = {
  name: 'qwen-anthropic-web-tools',
  applies: (scope) =>
    scope.endpointType === ENDPOINT_TYPE.ANTHROPIC_MESSAGES &&
    (matchesPreset(scope.provider, 'dashscope') || matchesPreset(scope.provider, 'qwencloud')),
  contributeModelAdapters: () => [
    definePlugin({
      name: 'qwen-anthropic-web-tools',
      enforce: 'pre',
      configureContext: (context) => {
        context.middlewares ??= []
        context.middlewares.push(createQwenAnthropicWebToolsMiddleware())
      }
    })
  ]
}
