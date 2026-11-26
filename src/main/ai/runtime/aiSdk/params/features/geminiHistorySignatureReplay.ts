import type { SharedV3ProviderOptions } from '@ai-sdk/provider'
import { isToolUIPart, type LanguageModelMiddleware, type UIMessage } from 'ai'

import { definePlugin } from '@cherrystudio/ai-core'
import { ENDPOINT_TYPE, UniqueModelIdSchema } from '@shared/data/types/model'
import { isGemini3Model, isGemini4Model } from '@shared/utils/model'

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
  contributeModelAdapters: ({ request, model }) => {
    const foreign = indexForeignHistory(request.messages ?? [], model.id)
    if (![...foreign.values()].includes(true)) return []

    const middleware: LanguageModelMiddleware = {
      specificationVersion: 'v3',
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
            return {
              ...message,
              content: message.content.map((part) => {
                if (part.type === 'text') {
                  const signatures = geminiSignatures(part.providerOptions).filter(([, signature]) =>
                    foreign.get(`text:${signature}`)
                  )
                  if (signatures.length === 0) return part
                  const providerOptions = { ...part.providerOptions }
                  for (const [namespace] of signatures) {
                    const options = { ...providerOptions[namespace] }
                    delete options.thoughtSignature
                    providerOptions[namespace] = options
                  }
                  return { ...part, providerOptions }
                }
                if (
                  part.type !== 'tool-call' ||
                  part.providerExecuted ||
                  !foreign.get(`tool:${part.toolCallId}`) ||
                  geminiSignatures(part.providerOptions).length === 0
                )
                  return part
                return {
                  ...part,
                  providerOptions: {
                    ...part.providerOptions,
                    cherry: { ...part.providerOptions?.cherry, omitGeminiThoughtSignature: true }
                  }
                }
              })
            }
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
