import { formatApiHost, validateApiHost } from '@renderer/utils/api'
import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'
import type { EndpointConfig } from '@shared/data/types/provider'
import { trim } from 'es-toolkit/compat'

import {
  findInvalidProviderImageEndpointDraft,
  mergeProviderImageEndpointDraft,
  type ProviderImageEndpointDraft,
  type ProviderImageEndpointDraftField
} from '../utils/providerImageEndpoints'

export const CUSTOM_PROVIDER_COMPATIBILITY_TYPES = ['new-api', 'openai', 'anthropic', 'gemini', 'custom'] as const

export type CustomProviderCompatibilityType = (typeof CUSTOM_PROVIDER_COMPATIBILITY_TYPES)[number]

export const CUSTOM_PROVIDER_TEXT_ENDPOINTS = [
  ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
  ENDPOINT_TYPE.OPENAI_RESPONSES,
  ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
  ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT
] as const

export type CustomProviderTextEndpoint = (typeof CUSTOM_PROVIDER_TEXT_ENDPOINTS)[number]
export type OpenAiCompatibilityEndpoint =
  | typeof ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
  | typeof ENDPOINT_TYPE.OPENAI_RESPONSES

export type CustomProviderCompatibility =
  | { type: 'new-api' }
  | { type: 'openai'; endpoint: OpenAiCompatibilityEndpoint }
  | { type: 'anthropic' }
  | { type: 'gemini' }
  | { type: 'custom'; endpoint: CustomProviderTextEndpoint }

export interface CustomProviderCreationInput {
  compatibility: CustomProviderCompatibility
  baseUrl: string
  extraTextEndpointUrls?: Partial<Record<CustomProviderTextEndpoint, string>>
  imageEndpointDraft?: ProviderImageEndpointDraft
}

export interface CustomProviderCreationPayload {
  presetProviderId?: 'new-api'
  defaultChatEndpoint: CustomProviderTextEndpoint
  endpointConfigs: Partial<Record<EndpointType, EndpointConfig>>
}

export type CustomProviderCreationInvalidUrl =
  | { field: 'baseUrl' }
  | { field: 'extraTextEndpointUrl'; endpointType: CustomProviderTextEndpoint }
  | { field: ProviderImageEndpointDraftField }

const ENDPOINT_PATHS: Record<CustomProviderTextEndpoint, string> = {
  [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: '/chat/completions',
  [ENDPOINT_TYPE.OPENAI_RESPONSES]: '/responses',
  [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: '/messages',
  [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]: '/models/{model}:generateContent'
}

export function getCustomProviderPrimaryEndpoint(
  compatibility: CustomProviderCompatibility
): CustomProviderTextEndpoint {
  switch (compatibility.type) {
    case 'new-api':
    case 'openai':
      return compatibility.type === 'openai' ? compatibility.endpoint : ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
    case 'anthropic':
      return ENDPOINT_TYPE.ANTHROPIC_MESSAGES
    case 'gemini':
      return ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT
    case 'custom':
      return compatibility.endpoint
  }
}

export function buildCustomProviderCreationPayload(input: CustomProviderCreationInput): CustomProviderCreationPayload {
  const baseUrl = trim(input.baseUrl)
  const defaultChatEndpoint = getCustomProviderPrimaryEndpoint(input.compatibility)
  const initialTextEndpoints: readonly CustomProviderTextEndpoint[] =
    input.compatibility.type === 'new-api' ? CUSTOM_PROVIDER_TEXT_ENDPOINTS : [defaultChatEndpoint]
  let endpointConfigs: Partial<Record<EndpointType, EndpointConfig>> = Object.fromEntries(
    initialTextEndpoints.map((endpointType) => [endpointType, { baseUrl }])
  )

  for (const endpointType of CUSTOM_PROVIDER_TEXT_ENDPOINTS) {
    if (endpointType === defaultChatEndpoint) {
      continue
    }

    const overrideUrl = trim(input.extraTextEndpointUrls?.[endpointType])
    if (overrideUrl) {
      endpointConfigs[endpointType] = {
        ...endpointConfigs[endpointType],
        baseUrl: overrideUrl
      }
    }
  }

  if (input.imageEndpointDraft) {
    endpointConfigs = mergeProviderImageEndpointDraft(endpointConfigs, input.imageEndpointDraft)
  }

  return {
    ...(input.compatibility.type === 'new-api' ? { presetProviderId: 'new-api' as const } : {}),
    defaultChatEndpoint,
    endpointConfigs
  }
}

export function buildCustomProviderEndpointPreview(baseUrl: string, endpointType: CustomProviderTextEndpoint): string {
  const value = trim(baseUrl)
  if (!value || !validateApiHost(value)) {
    return ''
  }

  const formattedHost =
    endpointType === ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT ? formatApiHost(value, true, 'v1beta') : formatApiHost(value)
  return `${formattedHost}${ENDPOINT_PATHS[endpointType]}`
}

export function findInvalidCustomProviderCreationUrl(
  input: CustomProviderCreationInput
): CustomProviderCreationInvalidUrl | null {
  const baseUrl = trim(input.baseUrl)
  if (!baseUrl || !validateApiHost(baseUrl)) {
    return { field: 'baseUrl' }
  }

  const primaryEndpoint = getCustomProviderPrimaryEndpoint(input.compatibility)
  for (const endpointType of CUSTOM_PROVIDER_TEXT_ENDPOINTS) {
    if (endpointType === primaryEndpoint) {
      continue
    }

    const value = trim(input.extraTextEndpointUrls?.[endpointType])
    if (value && !validateApiHost(value)) {
      return { field: 'extraTextEndpointUrl', endpointType }
    }
  }

  if (input.imageEndpointDraft) {
    const invalidImageField = findInvalidProviderImageEndpointDraft(input.imageEndpointDraft)
    if (invalidImageField) {
      return { field: invalidImageField }
    }
  }

  return null
}
