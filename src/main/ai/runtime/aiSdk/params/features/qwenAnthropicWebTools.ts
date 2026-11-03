import type { LanguageModelMiddleware } from 'ai'
import * as z from 'zod'

import { definePlugin, type StreamTextParams, type StreamTextResult } from '@cherrystudio/ai-core'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { matchesPreset } from '@shared/utils/provider'

import type { RequestFeature } from '../feature'

const CLIENT_IDENTIFIER = 'x-anthropic-billing-header: cc_entrypoint=cli;'
const webFetchInputSchema = z.union([
  z.object({ url: z.string() }),
  z.object({ urls: z.array(z.string()).min(1), goal: z.string().optional() })
])

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
    definePlugin<StreamTextParams, StreamTextResult>({
      name: 'qwen-anthropic-web-tools',
      enforce: 'pre',
      transformParams: (params) => ({
        ...params,
        tools:
          params.tools &&
          Object.fromEntries(
            Object.entries(params.tools).map(([name, tool]) => [
              name,
              // Qwen returns urls + goal; preserve that input instead of triggering an AI repair for a finished server tool.
              tool.type === 'provider' && /^anthropic\.web_fetch_\d+$/.test(tool.id)
                ? { ...tool, inputSchema: webFetchInputSchema }
                : tool
            ])
          )
      }),
      configureContext: (context) => {
        context.middlewares ??= []
        context.middlewares.push(createQwenAnthropicWebToolsMiddleware())
      }
    })
  ]
}
