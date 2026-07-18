import type { EndpointType, Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { isApiGatewayProviderId } from '@shared/types/codeCli'
import { formatApiHost, withoutTrailingSlash } from '@shared/utils/api'

import {
  CODEX_CHAT_ENDPOINT,
  CODEX_RESPONSES_ENDPOINT,
  GEMINI_AGGREGATOR_BASE_URLS,
  OPEN_CODE_ENDPOINTS,
  PI_ENDPOINTS
} from './constants'

export interface OpenCodeNpmInfo {
  npm: string
  providerType: 'anthropic' | 'google' | 'openai' | 'openai-compatible'
  endpointType: EndpointType
}

export type PiApi = 'anthropic-messages' | 'google-generative-ai' | 'openai-completions' | 'openai-responses'

export interface PiProviderInfo {
  api: PiApi
  baseUrl: string
  endpointType: EndpointType
}

export function resolveGeminiBaseUrl(provider: Provider): string {
  // The synthetic API-gateway provider serves every dialect off one bare host
  // (http://host:port) but deliberately declares NO google-generate-content
  // endpoint: OPEN_CODE_ENDPOINTS lists google first, so adding one would flip
  // OpenCode+gateway to the google dialect for every model. gemini-cli's
  // @google/genai SDK appends /v1beta itself, so return the bare host here.
  if (isApiGatewayProviderId(provider.id)) {
    const configs = provider.endpointConfigs ?? {}
    return configs['anthropic-messages']?.baseUrl ?? Object.values(configs)[0]?.baseUrl ?? ''
  }
  const dedicated = provider.endpointConfigs?.['google-generate-content']?.baseUrl
  if (dedicated) return dedicated
  const chatBaseUrl = provider.defaultChatEndpoint
    ? provider.endpointConfigs?.[provider.defaultChatEndpoint]?.baseUrl
    : undefined
  // Aggregators serving Gemini under a /gemini sub-path (aihubmix): derive from
  // the user-configured chat baseUrl — dropping a trailing /v1 — so a custom
  // mirror host wins; the static default applies only when nothing is configured.
  if (GEMINI_AGGREGATOR_BASE_URLS[provider.id]) {
    if (!chatBaseUrl) return GEMINI_AGGREGATOR_BASE_URLS[provider.id]
    return `${withoutTrailingSlash(chatBaseUrl).replace(/\/v1$/, '')}/gemini`
  }
  // Aggregators allow-listed for Gemini CLI (CLI_TOOL_PROVIDER_MAP) without a dedicated
  // google-generate-content endpoint or an entry above (e.g. CherryIN, DMXAPI) proxy every
  // protocol off the same host as their default chat endpoint — mirrors the fallback
  // buildCherryinConfig/dmxapiProvider.ts already rely on for real chat requests.
  return chatBaseUrl || ''
}

export function resolveClaudeBaseUrl(provider: Provider): string {
  return provider.endpointConfigs?.['anthropic-messages']?.baseUrl ?? ''
}

export function resolveCodexBaseUrl(provider: Provider): string {
  return formatApiHost(provider.endpointConfigs?.[CODEX_RESPONSES_ENDPOINT]?.baseUrl)
}

export function resolveOpenAIBaseUrl(provider: Provider): string {
  const responses = provider.endpointConfigs?.[CODEX_RESPONSES_ENDPOINT]?.baseUrl
  const chat = provider.endpointConfigs?.[CODEX_CHAT_ENDPOINT]?.baseUrl
  return formatApiHost(responses ?? chat)
}

/** Single source of truth for the OpenCode endpointType <-> npm package mapping (both directions derive from it). */
const OPEN_CODE_NPM_ENTRIES: Array<Pick<OpenCodeNpmInfo, 'endpointType' | 'npm' | 'providerType'>> = [
  { endpointType: 'google-generate-content', npm: '@ai-sdk/google', providerType: 'google' },
  { endpointType: 'anthropic-messages', npm: '@ai-sdk/anthropic', providerType: 'anthropic' },
  { endpointType: 'openai-responses', npm: '@ai-sdk/openai', providerType: 'openai' }
]
const OPEN_CODE_DEFAULT_NPM_INFO: Pick<OpenCodeNpmInfo, 'npm' | 'providerType'> = {
  npm: '@ai-sdk/openai-compatible',
  providerType: 'openai-compatible'
}

function toOpenCodeNpmInfo(endpointType: EndpointType): OpenCodeNpmInfo {
  const entry = OPEN_CODE_NPM_ENTRIES.find((e) => e.endpointType === endpointType)
  return {
    npm: entry?.npm ?? OPEN_CODE_DEFAULT_NPM_INFO.npm,
    providerType: entry?.providerType ?? OPEN_CODE_DEFAULT_NPM_INFO.providerType,
    endpointType
  }
}

function resolveSupportedEndpointType(
  provider: Provider,
  modelEndpointTypes: EndpointType[] | undefined,
  supportedEndpoints: readonly EndpointType[],
  fallbackEndpoint: EndpointType
): EndpointType {
  const hasEndpoint = (type: EndpointType) => Boolean(provider.endpointConfigs?.[type]?.baseUrl)
  const isSupported = (type: EndpointType | undefined): type is EndpointType =>
    Boolean(type && supportedEndpoints.includes(type))

  return (
    modelEndpointTypes?.find((type) => isSupported(type) && hasEndpoint(type)) ??
    (isSupported(provider.defaultChatEndpoint) && hasEndpoint(provider.defaultChatEndpoint)
      ? provider.defaultChatEndpoint
      : undefined) ??
    supportedEndpoints.find(hasEndpoint) ??
    fallbackEndpoint
  )
}

/** Reverse lookup of `toOpenCodeNpmInfo`, used when re-deriving info from an already-written opencode.json draft. */
export function openCodeNpmInfoFromNpmPackage(npm: string): OpenCodeNpmInfo {
  const entry = OPEN_CODE_NPM_ENTRIES.find((e) => e.npm === npm)
  return {
    npm,
    providerType: entry?.providerType ?? OPEN_CODE_DEFAULT_NPM_INFO.providerType,
    endpointType: entry?.endpointType ?? 'openai-chat-completions'
  }
}

export function resolveOpenCodeNpmInfo(provider: Provider, modelEndpointTypes?: EndpointType[]): OpenCodeNpmInfo {
  return toOpenCodeNpmInfo(
    resolveSupportedEndpointType(provider, modelEndpointTypes, OPEN_CODE_ENDPOINTS, 'openai-chat-completions')
  )
}

export function resolvePiProviderInfo(provider: Provider, modelEndpointTypes?: EndpointType[]): PiProviderInfo {
  const endpointType = resolveSupportedEndpointType(
    provider,
    modelEndpointTypes,
    PI_ENDPOINTS,
    'openai-chat-completions'
  )
  const rawBaseUrl = provider.endpointConfigs?.[endpointType]?.baseUrl
  const apiByEndpoint: Partial<Record<EndpointType, PiApi>> = {
    'anthropic-messages': 'anthropic-messages',
    'google-generate-content': 'google-generative-ai',
    'openai-chat-completions': 'openai-completions',
    'openai-responses': 'openai-responses'
  }
  const baseUrl =
    endpointType === 'google-generate-content'
      ? formatApiHost(rawBaseUrl, true, 'v1beta')
      : endpointType === 'openai-chat-completions' || endpointType === 'openai-responses'
        ? formatApiHost(rawBaseUrl)
        : withoutTrailingSlash(rawBaseUrl ?? '')

  return { api: apiByEndpoint[endpointType]!, baseUrl, endpointType }
}

export function modelSupportsReasoningEffort(modelRecord: Model | null): boolean {
  return !!modelRecord?.reasoning?.supportedEfforts?.length
}
