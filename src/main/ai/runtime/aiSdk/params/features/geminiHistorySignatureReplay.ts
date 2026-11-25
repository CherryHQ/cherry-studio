import type { LanguageModelV3StreamPart, SharedV3ProviderOptions } from '@ai-sdk/provider'
import { isToolUIPart, type LanguageModelMiddleware, type UIMessage } from 'ai'

import { definePlugin } from '@cherrystudio/ai-core'
import { ENDPOINT_TYPE, UniqueModelIdSchema } from '@shared/data/types/model'
import { isGemini3Model, isGemini4Model } from '@shared/utils/model'

import { getReplayRouteId } from '../../../../provider/replayRoute'
import type { RequestFeature } from '../feature'

function geminiSignatures(options: SharedV3ProviderOptions | undefined): Array<[string, string]> {
  const signatures: Array<[string, string]> = []
  for (const namespace of ['google', 'vertex', 'googleVertex']) {
    const signature = options?.[namespace]?.thoughtSignature
    if (typeof signature === 'string' && signature.trim()) signatures.push([namespace, signature])
  }
  return signatures
}

function indexForeignHistory(messages: UIMessage[], targetModelId: string): Map<string, boolean> {
  const foreign = new Map<string, boolean>()
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    const metadata = message.metadata
    const source = UniqueModelIdSchema.safeParse(
      metadata && typeof metadata === 'object' && 'modelId' in metadata ? metadata.modelId : undefined
    )
    const isForeign = source.success && source.data !== targetModelId
    for (const part of message.parts) {
      if (isToolUIPart(part)) {
        const key = `tool:${part.toolCallId}`
        // Reused call IDs cannot identify a unique source.
        foreign.set(key, isForeign && !foreign.has(key))
      } else if (part.type === 'text') {
        for (const [, signature] of geminiSignatures(part.providerMetadata)) {
          const key = `text:${signature}`
          foreign.set(key, isForeign && foreign.get(key) !== false)
        }
      }
    }
  }
  return foreign
}

export const geminiHistorySignatureReplayFeature: RequestFeature = {
  name: 'gemini-history-signature-replay',
  applies: ({ request, endpointType, model }) =>
    request.contextOwner !== 'caller' &&
    endpointType === ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT &&
    (isGemini3Model(model) || isGemini4Model(model)),
  contributeModelAdapters: ({ request, model, endpointType, sdkConfig }) => {
    const routeId = getReplayRouteId(model.providerId, endpointType, sdkConfig)
    const foreign = indexForeignHistory(request.messages ?? [], model.id)

    const stamp = <T extends { providerMetadata?: SharedV3ProviderOptions }>(part: T): T => {
      const metadata = part.providerMetadata
      if (geminiSignatures(metadata).length === 0) return part
      return { ...part, providerMetadata: { ...metadata, cherry: { ...metadata?.cherry, replayRouteId: routeId } } }
    }

    const middleware: LanguageModelMiddleware = {
      specificationVersion: 'v3',
      wrapGenerate: async ({ doGenerate }) => {
        const result = await doGenerate()
        return { ...result, content: result.content.map((part) => ('providerMetadata' in part ? stamp(part) : part)) }
      },
      wrapStream: async ({ doStream }) => {
        const result = await doStream()
        return {
          ...result,
          stream: result.stream.pipeThrough(
            new TransformStream<LanguageModelV3StreamPart, LanguageModelV3StreamPart>({
              transform(part, controller) {
                controller.enqueue('providerMetadata' in part ? stamp(part) : part)
              }
            })
          )
        }
      },
      transformParams: async ({ params }) => {
        const currentTurn = params.prompt.findLastIndex(
          (message) =>
            message.role === 'user' && message.content.some((part) => part.type === 'text' && part.text.trim())
        )
        if (currentTurn < 0) return params
        return {
          ...params,
          prompt: params.prompt.map((message, index) => {
            if (index >= currentTurn || message.role !== 'assistant') return message
            const content = message.content.flatMap((part): typeof message.content => {
              const sourceRoute = part.providerOptions?.cherry?.replayRouteId
              const signatures = geminiSignatures(part.providerOptions).filter(([, signature]) => {
                if (typeof sourceRoute === 'string') return sourceRoute !== routeId
                if (part.type === 'text') return foreign.get(`text:${signature}`)
                if (part.type === 'tool-call') return foreign.get(`tool:${part.toolCallId}`)
                return false
              })
              if (signatures.length === 0) return [part]
              if (part.type === 'reasoning') return []
              if (part.type === 'text' || part.type === 'file') {
                const providerOptions = { ...part.providerOptions }
                for (const [namespace] of signatures) {
                  const options = { ...providerOptions[namespace] }
                  delete options.thoughtSignature
                  providerOptions[namespace] = options
                }
                return [{ ...part, providerOptions }]
              }
              if (part.type !== 'tool-call' || part.providerExecuted) return [part]
              return [
                {
                  ...part,
                  providerOptions: {
                    ...part.providerOptions,
                    cherry: { ...part.providerOptions?.cherry, omitGeminiThoughtSignature: true }
                  }
                }
              ]
            })
            // Generate Content rejects empty assistant turns after the history filter.
            return { ...message, content: content.length ? content : [{ type: 'text', text: '...' }] }
          })
        }
      }
    }

    return [
      definePlugin({
        name: 'gemini-history-signature-replay',
        enforce: 'pre',
        configureContext: (context) => {
          context.middlewares ??= []
          context.middlewares.push(middleware)
        }
      })
    ]
  }
}
