import {
  isAzureOpenAIProvider,
  isCherryAIProvider,
  isNewApiProvider,
  isPerplexityProvider,
  isVertexProvider
} from '@renderer/pages/settings/ProviderSettings/utils/provider'
import { formatApiHost } from '@renderer/utils'
import { formatOllamaApiHost, formatVertexApiHost, isWithTrailingSharp } from '@renderer/utils/api'
import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'
import type { AuthConfig, Provider } from '@shared/data/types/provider'

export function buildHostEndpointPreviews(params: {
  provider: Provider
  /** Vertex-only: provider's iam-gcp authConfig from `/providers/:id/auth-config`. */
  authConfig?: AuthConfig | null
  primaryEndpoint: EndpointType
  apiHost: string
  anthropicApiHost: string
  providerAnthropicHost: string
}) {
  const { provider, authConfig, primaryEndpoint, apiHost, anthropicApiHost, providerAnthropicHost } = params
  const appendVersion = !isWithTrailingSharp(apiHost)
  let formattedHost: string

  if (primaryEndpoint === ENDPOINT_TYPE.ANTHROPIC_MESSAGES) {
    formattedHost = formatApiHost(anthropicApiHost || apiHost, appendVersion)
  } else if (
    provider.id === 'copilot' ||
    provider.id === 'github' ||
    isCherryAIProvider(provider) ||
    isPerplexityProvider(provider) ||
    isNewApiProvider(provider) ||
    isAzureOpenAIProvider(provider)
  ) {
    formattedHost = formatApiHost(apiHost, false)
  } else if (primaryEndpoint === ENDPOINT_TYPE.OLLAMA_CHAT) {
    formattedHost = formatOllamaApiHost(apiHost)
  } else if (primaryEndpoint === ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT) {
    formattedHost = formatApiHost(apiHost, appendVersion, 'v1beta')
  } else if (isVertexProvider(provider)) {
    // Vertex project/location live on the `iam-gcp` authConfig discriminator.
    // Empty fallbacks keep the formatter resilient when authConfig is unset
    // during onboarding — formatVertexApiHost still produces a usable preview.
    const project = authConfig?.type === 'iam-gcp' ? authConfig.project : ''
    const location = authConfig?.type === 'iam-gcp' ? authConfig.location : ''
    formattedHost = formatVertexApiHost({ apiHost, project, location })
  } else {
    formattedHost = formatApiHost(apiHost, appendVersion)
  }

  const hostPreview = (() => {
    if (primaryEndpoint === ENDPOINT_TYPE.OLLAMA_CHAT) return `${formattedHost}/chat`
    if (provider.id === 'gateway') return `${formattedHost}/language-model`
    if (isAzureOpenAIProvider(provider)) {
      const version = provider.settings?.apiVersion || ''
      const path = !['preview', 'v1'].includes(version)
        ? '/v1/chat/completions?apiVersion=v1'
        : '/v1/responses?apiVersion=v1'
      return `${formattedHost}${path}`
    }
    if (primaryEndpoint === ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS) return `${formattedHost}/chat/completions`
    if (primaryEndpoint === ENDPOINT_TYPE.OPENAI_RESPONSES) return `${formattedHost}/responses`
    if (primaryEndpoint === ENDPOINT_TYPE.ANTHROPIC_MESSAGES) return `${formattedHost}/messages`
    if (primaryEndpoint === ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT) return `${formattedHost}/models`
    if (isVertexProvider(provider)) return `${formattedHost}/publishers/google`

    return formattedHost
  })()

  const anthropicHostPreview = `${formatApiHost(anthropicApiHost || providerAnthropicHost)}/messages`

  return {
    hostPreview,
    anthropicHostPreview
  }
}
