import type { EndpointType, Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { formatApiHost, withoutTrailingApiVersion, withoutTrailingSlash } from '@shared/utils/api'
import { resolveGeminiBaseUrl } from '@shared/utils/gemini'

import {
  CODEX_CHAT_ENDPOINT,
  CODEX_RESPONSES_ENDPOINT,
  HERMES_ENDPOINTS,
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

export const HERMES_API_MODES = ['anthropic_messages', 'chat_completions', 'codex_responses'] as const
export type HermesApiMode = (typeof HERMES_API_MODES)[number]

export interface HermesProviderInfo {
  apiMode: HermesApiMode
  baseUrl: string
  endpointType: EndpointType
}

export { resolveGeminiBaseUrl }

export function resolveClaudeBaseUrl(provider: Provider): string {
  const baseUrl = provider.endpointConfigs?.['anthropic-messages']?.baseUrl
  return baseUrl ? withoutTrailingApiVersion(formatApiHost(baseUrl, false)) : ''
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
  const isModelCapable = (type: EndpointType) => !modelEndpointTypes?.length || modelEndpointTypes.includes(type)

  return (
    (isSupported(provider.defaultChatEndpoint) &&
    isModelCapable(provider.defaultChatEndpoint) &&
    hasEndpoint(provider.defaultChatEndpoint)
      ? provider.defaultChatEndpoint
      : undefined) ??
    modelEndpointTypes?.find((type) => isSupported(type) && hasEndpoint(type)) ??
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

export function resolveHermesProviderInfo(provider: Provider, modelEndpointTypes?: EndpointType[]): HermesProviderInfo {
  const endpointType = resolveSupportedEndpointType(
    provider,
    modelEndpointTypes,
    HERMES_ENDPOINTS,
    'openai-chat-completions'
  )
  const rawBaseUrl = provider.endpointConfigs?.[endpointType]?.baseUrl
  const apiMode: HermesApiMode =
    endpointType === 'anthropic-messages'
      ? 'anthropic_messages'
      : endpointType === 'openai-responses'
        ? 'codex_responses'
        : 'chat_completions'
  const baseUrl =
    endpointType === 'anthropic-messages'
      ? withoutTrailingApiVersion(formatApiHost(rawBaseUrl, false))
      : formatApiHost(rawBaseUrl)

  return { apiMode, baseUrl, endpointType }
}

export function modelSupportsReasoningEffort(modelRecord: Model | null): boolean {
  return !!modelRecord?.reasoning?.selectableEfforts?.length
}
