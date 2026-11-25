import { definePlugin } from '@cherrystudio/ai-core'
import { ENDPOINT_TYPE } from '@shared/data/types/model'

import { getReplayEndpoint, needsPlainToolReasoning } from '../../../../provider/replayRoute'
import type { RequestFeature } from '../feature'
import { geminiSignatures } from './geminiHistorySignatureReplay'
import { createProviderStateReplayMiddleware } from './providerStateReplay'

export const conversationStateReplayFeature: RequestFeature = {
  name: 'conversation-state-replay',
  applies: (scope) => {
    if (scope.request.contextOwner === 'caller' || scope.sdkConfig.providerId === 'openrouter') return false
    const endpoint = getReplayEndpoint(scope.endpointType, scope.sdkConfig)
    return (
      endpoint === undefined ||
      endpoint === ENDPOINT_TYPE.OPENAI_RESPONSES ||
      endpoint === ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS ||
      endpoint === ENDPOINT_TYPE.OLLAMA_CHAT
    )
  },
  contributeModelAdapters: (scope) => {
    const { model, sdkConfig, replayRouteId } = scope
    const endpoint = getReplayEndpoint(scope.endpointType, sdkConfig)
    const responses = endpoint === ENDPOINT_TYPE.OPENAI_RESPONSES
    const namespaces = [...new Set(['openai', 'xai', sdkConfig.providerOptionsKey])]
    return [
      definePlugin({
        name: 'conversation-state-replay',
        enforce: 'pre',
        configureContext: (context) => {
          context.middlewares ??= []
          context.middlewares.push(
            createProviderStateReplayMiddleware({
              routeId: replayRouteId,
              capturePlainReasoning: true,
              requirePlainReasoning: needsPlainToolReasoning(endpoint, model),
              ...(responses && { responsesOptionsKey: sdkConfig.providerOptionsKey }),
              hasState: (metadata) =>
                geminiSignatures(metadata).length > 0 ||
                typeof metadata?.openaiCompatible?.reasoningEncryptedContent === 'string' ||
                (responses &&
                  namespaces.some(
                    (key) =>
                      typeof metadata?.[key]?.itemId === 'string' ||
                      typeof metadata?.[key]?.reasoningEncryptedContent === 'string' ||
                      metadata?.[key]?.rawReasoningContent === true
                  )),
              omitState: (part) => {
                const providerOptions = { ...part.providerOptions }
                const signatures = geminiSignatures(part.providerOptions)
                for (const [key] of signatures) {
                  const options = { ...providerOptions[key] }
                  delete options.thoughtSignature
                  providerOptions[key] = options
                }
                if (part.type === 'tool-call' && signatures.length > 0) {
                  providerOptions.cherry = { ...providerOptions.cherry, omitGeminiThoughtSignature: true }
                }
                for (const key of namespaces) {
                  if (!responses || !providerOptions[key]) continue
                  const options = { ...providerOptions[key] }
                  delete options.itemId
                  delete options.reasoningEncryptedContent
                  providerOptions[key] = options
                }
                return { ...part, providerOptions }
              }
            })
          )
        }
      })
    ]
  }
}
