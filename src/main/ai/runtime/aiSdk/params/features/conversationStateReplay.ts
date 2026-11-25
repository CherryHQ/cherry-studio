import { definePlugin } from '@cherrystudio/ai-core'
import { ENDPOINT_TYPE } from '@shared/data/types/model'

import { getReplayEndpoint, getReplayRouteId, needsPlainToolReasoning } from '../../../../provider/replayRoute'
import type { RequestFeature } from '../feature'
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
    const { provider, model, sdkConfig } = scope
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
              routeId: getReplayRouteId(provider.id, endpoint, sdkConfig),
              capturePlainReasoning: true,
              requirePlainReasoning: needsPlainToolReasoning(endpoint, model),
              ...(responses && { responsesOptionsKey: sdkConfig.providerOptionsKey }),
              hasState: (metadata) =>
                responses &&
                namespaces.some(
                  (key) =>
                    typeof metadata?.[key]?.itemId === 'string' ||
                    typeof metadata?.[key]?.reasoningEncryptedContent === 'string'
                ),
              omitState: (part) => {
                const providerOptions = { ...part.providerOptions }
                for (const key of namespaces) {
                  if (!providerOptions[key]) continue
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
