import type { LanguageModelMiddleware } from 'ai'

import { definePlugin } from '@cherrystudio/ai-core'
import { GROK_CLI_PROVIDER_ID } from '@shared/data/presets/grokCli'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { getRawModelId } from '@shared/utils/model'

import type { RequestFeature } from '../feature'

export function createGrokReasoningReplayMiddleware(providerId: string, modelId: string): LanguageModelMiddleware {
  const isGrokCli = providerId === GROK_CLI_PROVIDER_ID
  const origin = { providerId, modelId }
  return {
    specificationVersion: 'v3',
    transformParams: async ({ params }) => ({
      ...params,
      prompt: params.prompt.map((message) => {
        if (message.role !== 'assistant') return message
        return {
          ...message,
          content: message.content.filter((part) => {
            if (part.type !== 'reasoning') return true
            const source = part.providerOptions?.grokCli
            if (!source && !isGrokCli) return true
            // Encrypted reasoning is bound to the provider and model that produced it.
            return source?.providerId === providerId && source?.modelId === modelId
          })
        }
      })
    }),
    wrapGenerate: async ({ doGenerate }) => {
      const result = await doGenerate()
      if (!isGrokCli) return result
      return {
        ...result,
        content: result.content.map((part) =>
          part.type === 'reasoning'
            ? { ...part, providerMetadata: { ...part.providerMetadata, grokCli: origin } }
            : part
        )
      }
    },
    wrapStream: async ({ doStream }) => {
      const result = await doStream()
      if (!isGrokCli) return result
      return {
        ...result,
        stream: result.stream.pipeThrough(
          new TransformStream({
            transform(part, controller) {
              controller.enqueue(
                part.type === 'reasoning-start' || part.type === 'reasoning-end' || part.type === 'reasoning-delta'
                  ? { ...part, providerMetadata: { ...part.providerMetadata, grokCli: origin } }
                  : part
              )
            }
          })
        )
      }
    }
  }
}

export const grokReasoningReplayFeature: RequestFeature = {
  name: 'grok-reasoning-replay',
  applies: (scope) => scope.endpointType === ENDPOINT_TYPE.OPENAI_RESPONSES,
  contributeModelAdapters: (scope) => [
    definePlugin({
      name: 'grok-reasoning-replay',
      enforce: 'pre',
      configureContext: (context) => {
        context.middlewares ??= []
        context.middlewares.push(createGrokReasoningReplayMiddleware(scope.provider.id, getRawModelId(scope.model)))
      }
    })
  ]
}
