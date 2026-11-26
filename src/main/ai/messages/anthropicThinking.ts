import type { LanguageModelV3Message, SharedV3ProviderMetadata } from '@ai-sdk/provider'
import type { ModelMessage } from 'ai'

import { resolveAihubmixEndpointType } from '@shared/data/presets/gatewayChatRouting'
import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'
import { SystemProviderIds } from '@shared/utils/systemProviderId'

export function usesAnthropicMessagesSdk(
  providerId: string,
  route?: { endpointType: EndpointType | undefined; sdkConfig: { modelId: string } }
): boolean {
  if (providerId === SystemProviderIds.aihubmix && route) {
    return resolveAihubmixEndpointType(route.sdkConfig.modelId) === ENDPOINT_TYPE.ANTHROPIC_MESSAGES
  }
  return (
    ['anthropic', 'azure-anthropic', 'google-vertex-anthropic'].includes(providerId) ||
    (providerId === SystemProviderIds.cherryin && route?.endpointType === ENDPOINT_TYPE.ANTHROPIC_MESSAGES)
  )
}

export function hasAnthropicThinkingCredential(metadata: SharedV3ProviderMetadata | undefined): boolean {
  const anthropic = metadata?.anthropic
  return typeof anthropic?.signature === 'string' || typeof anthropic?.redactedData === 'string'
}

export function omitCompactedAnthropicThinking<T extends LanguageModelV3Message | ModelMessage>(messages: T[]): T[] {
  return messages.flatMap<T>((message) => {
    if (message.role !== 'assistant' || typeof message.content === 'string') return [message]
    const content = message.content.filter(
      (part) => part.type !== 'reasoning' || !hasAnthropicThinkingCredential(part.providerOptions)
    )
    if (content.length === message.content.length) return [message]
    if (content.every((part) => part.type === 'reasoning')) return []
    return [{ ...message, content }]
  })
}
