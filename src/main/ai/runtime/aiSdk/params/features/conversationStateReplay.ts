import { definePlugin } from '@cherrystudio/ai-core'
import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'
import { isGemini3Model, isGemini4Model } from '@shared/utils/model'

import { getReplayEndpoint, needsPlainToolReasoning } from '../../../../provider/replayRoute'
import type { RequestFeature } from '../feature'
import type { RequestScope } from '../scope'
import {
  geminiCompatibleToolSignatures,
  hasGeminiSignature,
  legacyGeminiHistory,
  omitGeminiSignature
} from './geminiHistorySignatureReplay'
import { createProviderStateReplayMiddleware } from './providerStateReplay'

function isGeminiCompatibleChat({ model }: RequestScope, endpoint: EndpointType | undefined) {
  return (
    (endpoint === ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS || endpoint === undefined) &&
    (isGemini3Model(model) || isGemini4Model(model))
  )
}

export const conversationStateReplayFeature: RequestFeature = {
  name: 'conversation-state-replay',
  applies: (scope) => {
    if (scope.sdkConfig.providerId === 'openrouter') return false
    const endpoint = getReplayEndpoint(scope.endpointType, scope.sdkConfig)
    if (scope.request.contextOwner === 'caller') return isGeminiCompatibleChat(scope, endpoint)
    return (
      endpoint === undefined ||
      endpoint === ENDPOINT_TYPE.OPENAI_RESPONSES ||
      endpoint === ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS ||
      endpoint === ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT ||
      endpoint === ENDPOINT_TYPE.OLLAMA_CHAT
    )
  },
  contributeModelAdapters: (scope) => {
    const { model, request, sdkConfig, replayRouteId } = scope
    const endpoint = getReplayEndpoint(scope.endpointType, sdkConfig)
    const responses = endpoint === ENDPOINT_TYPE.OPENAI_RESPONSES
    const nativeGemini = endpoint === ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT
    const compatibleGemini = isGeminiCompatibleChat(scope, endpoint)
    const needsLegacyGeminiReplay =
      compatibleGemini || (nativeGemini && (isGemini3Model(model) || isGemini4Model(model)))
    const namespaces = [...new Set(['openai', 'xai', sdkConfig.providerOptionsKey])]
    return [
      definePlugin({
        name: 'conversation-state-replay',
        enforce: 'pre',
        configureContext: (context) => {
          context.middlewares ??= []
          if (request.contextOwner !== 'caller') {
            context.middlewares.push(
              createProviderStateReplayMiddleware({
                routeId: replayRouteId,
                capturePlainReasoning: !nativeGemini,
                requirePlainReasoning: needsPlainToolReasoning(endpoint, model),
                ...(needsLegacyGeminiReplay && {
                  isLegacyForeign: legacyGeminiHistory(request.messages ?? [], model.id)
                }),
                ...(responses && { responsesOptionsKey: sdkConfig.providerOptionsKey }),
                hasState: (metadata) =>
                  hasGeminiSignature(metadata) ||
                  typeof metadata?.openaiCompatible?.reasoningEncryptedContent === 'string' ||
                  (responses &&
                    namespaces.some(
                      (key) =>
                        typeof metadata?.[key]?.itemId === 'string' ||
                        typeof metadata?.[key]?.reasoningEncryptedContent === 'string' ||
                        metadata?.[key]?.rawReasoningContent === true
                    )),
                omitState: (part) => {
                  const retained =
                    nativeGemini || compatibleGemini || hasGeminiSignature(part.providerOptions)
                      ? omitGeminiSignature(part)
                      : part
                  if (!responses) return retained
                  const providerOptions = { ...retained.providerOptions }
                  for (const key of namespaces) {
                    if (!providerOptions[key]) continue
                    const options = { ...providerOptions[key] }
                    delete options.itemId
                    delete options.reasoningEncryptedContent
                    providerOptions[key] = options
                  }
                  return { ...retained, providerOptions }
                }
              })
            )
          }
          if (compatibleGemini) context.middlewares.push(geminiCompatibleToolSignatures)
        }
      })
    ]
  }
}
