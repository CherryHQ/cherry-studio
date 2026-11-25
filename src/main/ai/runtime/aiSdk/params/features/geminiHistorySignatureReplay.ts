import type { SharedV3ProviderOptions } from '@ai-sdk/provider'
import { isToolUIPart, type UIMessage } from 'ai'

import { definePlugin } from '@cherrystudio/ai-core'
import { ENDPOINT_TYPE, UniqueModelIdSchema } from '@shared/data/types/model'
import { isGemini3Model, isGemini4Model } from '@shared/utils/model'

import { getReplayEndpoint, getReplayRouteId } from '../../../../provider/replayRoute'
import type { RequestFeature } from '../feature'
import { createProviderStateReplayMiddleware } from './providerStateReplay'

export function geminiSignatures(options: SharedV3ProviderOptions | undefined): Array<[string, string]> {
  const signatures: Array<[string, string]> = []
  for (const [namespace, optionsValue] of Object.entries(options ?? {})) {
    const signature = optionsValue?.thoughtSignature
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
  applies: ({ request, endpointType, sdkConfig }) =>
    request.contextOwner !== 'caller' &&
    getReplayEndpoint(endpointType, sdkConfig) === ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT,
  contributeModelAdapters: ({ request, model, endpointType, sdkConfig }) => {
    const foreign =
      isGemini3Model(model) || isGemini4Model(model) ? indexForeignHistory(request.messages ?? [], model.id) : undefined
    const middleware = createProviderStateReplayMiddleware({
      routeId: getReplayRouteId(model.providerId, endpointType, sdkConfig),
      hasState: (options) => geminiSignatures(options).length > 0,
      isLegacyForeign: (part) => {
        if (part.type === 'text') {
          return geminiSignatures(part.providerOptions).some(([, signature]) => foreign?.get(`text:${signature}`))
        }
        return part.type === 'tool-call' && foreign?.get(`tool:${part.toolCallId}`) === true
      },
      omitState: (part) => {
        if (part.type === 'tool-call' && part.providerExecuted) return part
        const providerOptions = { ...part.providerOptions }
        if (part.type === 'text' || part.type === 'file') {
          for (const [namespace] of geminiSignatures(part.providerOptions)) {
            const options = { ...providerOptions[namespace] }
            delete options.thoughtSignature
            providerOptions[namespace] = options
          }
        }
        if (part.type === 'tool-call') {
          providerOptions.cherry = { ...providerOptions.cherry, omitGeminiThoughtSignature: true }
        }
        return { ...part, providerOptions }
      }
    })

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
