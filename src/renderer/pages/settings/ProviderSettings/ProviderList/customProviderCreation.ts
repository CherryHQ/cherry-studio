import { formatApiHost, validateApiHost } from '@renderer/utils/api'
import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'
import type { EndpointConfig } from '@shared/data/types/provider'
import { trim } from 'es-toolkit/compat'

export const CUSTOM_PROVIDER_TEXT_ENDPOINTS = [
  ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
  ENDPOINT_TYPE.OPENAI_RESPONSES,
  ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
  ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT
] as const

export const CUSTOM_PROVIDER_IMAGE_ENDPOINTS = [
  ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION,
  ENDPOINT_TYPE.OPENAI_IMAGE_EDIT
] as const

export const CUSTOM_PROVIDER_ENDPOINTS = [
  ...CUSTOM_PROVIDER_TEXT_ENDPOINTS,
  ...CUSTOM_PROVIDER_IMAGE_ENDPOINTS
] as const

export type CustomProviderTextEndpoint = (typeof CUSTOM_PROVIDER_TEXT_ENDPOINTS)[number]
export type CustomProviderEndpoint = (typeof CUSTOM_PROVIDER_ENDPOINTS)[number]
export type CustomProviderEndpointUrls = Partial<Record<CustomProviderEndpoint, string>>

export interface CustomProviderCreationInput {
  endpointUrls: CustomProviderEndpointUrls
  preferredChatEndpoint?: CustomProviderTextEndpoint
}

export interface CustomProviderCreationPayload {
  defaultChatEndpoint: CustomProviderTextEndpoint
  endpointConfigs: Partial<Record<EndpointType, EndpointConfig>>
}

export type CustomProviderCreationInvalidUrl =
  | { field: 'textEndpointRequired' }
  | { field: 'endpointUrl'; endpointType: CustomProviderEndpoint }

const ENDPOINT_PATHS: Record<CustomProviderEndpoint, string> = {
  [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: '/chat/completions',
  [ENDPOINT_TYPE.OPENAI_RESPONSES]: '/responses',
  [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: '/messages',
  [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]: '/models/{model}:generateContent',
  [ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION]: '/images/generations',
  [ENDPOINT_TYPE.OPENAI_IMAGE_EDIT]: '/images/edits'
}

export function getCustomProviderDefaultChatEndpoint(
  endpointUrls: CustomProviderEndpointUrls,
  preferredChatEndpoint?: CustomProviderTextEndpoint
): CustomProviderTextEndpoint {
  if (preferredChatEndpoint && trim(endpointUrls[preferredChatEndpoint])) {
    return preferredChatEndpoint
  }

  return (
    CUSTOM_PROVIDER_TEXT_ENDPOINTS.find((endpointType) => trim(endpointUrls[endpointType])) ??
    ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
  )
}

export function buildCustomProviderCreationPayload(input: CustomProviderCreationInput): CustomProviderCreationPayload {
  const endpointConfigs: Partial<Record<EndpointType, EndpointConfig>> = {}
  for (const endpointType of CUSTOM_PROVIDER_ENDPOINTS) {
    const baseUrl = trim(input.endpointUrls[endpointType])
    if (baseUrl) {
      endpointConfigs[endpointType] = { baseUrl }
    }
  }

  return {
    defaultChatEndpoint: getCustomProviderDefaultChatEndpoint(input.endpointUrls, input.preferredChatEndpoint),
    endpointConfigs
  }
}

export function buildCustomProviderEndpointPreview(baseUrl: string, endpointType: CustomProviderEndpoint): string {
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
  if (!CUSTOM_PROVIDER_TEXT_ENDPOINTS.some((endpointType) => trim(input.endpointUrls[endpointType]))) {
    return { field: 'textEndpointRequired' }
  }

  return findInvalidCustomProviderEndpointUrl(input.endpointUrls)
}

export function findInvalidCustomProviderEndpointUrl(
  endpointUrls: CustomProviderEndpointUrls
): CustomProviderCreationInvalidUrl | null {
  for (const endpointType of CUSTOM_PROVIDER_ENDPOINTS) {
    const value = trim(endpointUrls[endpointType])
    if (value && !validateApiHost(value)) {
      return { field: 'endpointUrl', endpointType }
    }
  }

  return null
}
