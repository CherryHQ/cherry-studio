import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

const PRIMARY_CHAT_ENDPOINT_PRIORITY: EndpointType[] = [
  ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
  ENDPOINT_TYPE.OPENAI_RESPONSES,
  ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
  ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT,
  ENDPOINT_TYPE.OLLAMA_CHAT
]

export interface ProviderHostTopology {
  primaryEndpoint: EndpointType
  primaryBaseUrl: string
  anthropicBaseUrl: string
  hasAnthropicEndpoint: boolean
}

function hasEndpointConfig(provider: Provider | undefined, endpoint: EndpointType) {
  return Object.prototype.hasOwnProperty.call(provider?.endpointConfigs ?? {}, endpoint)
}

function resolvePrimaryEndpoint(provider: Provider | undefined): EndpointType {
  if (provider?.defaultChatEndpoint) {
    return provider.defaultChatEndpoint
  }

  for (const endpoint of PRIMARY_CHAT_ENDPOINT_PRIORITY) {
    if (hasEndpointConfig(provider, endpoint)) {
      return endpoint
    }
  }

  // A provider that declares no chat endpoint at all — an image-only one such
  // as ComfyUI — still has exactly one endpoint whose host the API Host field
  // means. Defaulting to `openai-chat-completions` there wrote the user's host
  // to a key nothing reads: the image endpoint kept the registry's default, so
  // generation silently ignored the configured host. Registry keys are ordered
  // first by `mergeEndpointConfigs`, so this picks an endpoint the provider
  // actually declares even when a stale chat override is also present.
  const declared = Object.keys(provider?.endpointConfigs ?? {}) as EndpointType[]
  if (declared.length > 0) {
    return declared[0]
  }

  return ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
}

export function getProviderHostTopology(provider: Provider | undefined): ProviderHostTopology {
  const primaryEndpoint = resolvePrimaryEndpoint(provider)
  const primaryBaseUrl = provider?.endpointConfigs?.[primaryEndpoint]?.baseUrl ?? ''
  const anthropicBaseUrl = provider?.endpointConfigs?.[ENDPOINT_TYPE.ANTHROPIC_MESSAGES]?.baseUrl ?? ''

  return {
    primaryEndpoint,
    primaryBaseUrl,
    anthropicBaseUrl,
    hasAnthropicEndpoint: hasEndpointConfig(provider, ENDPOINT_TYPE.ANTHROPIC_MESSAGES)
  }
}
