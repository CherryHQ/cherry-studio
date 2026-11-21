import { formatApiHost, validateApiHost, withoutTrailingSharp } from '@renderer/utils/api'
import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'
import type { EndpointConfig } from '@shared/data/types/provider'

const ENDPOINT_PATHS: Partial<Record<EndpointType, string>> = {
  [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: '/chat/completions',
  [ENDPOINT_TYPE.OPENAI_RESPONSES]: '/responses',
  [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: '/messages',
  [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]: '/models/{model}:generateContent',
  [ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION]: '/images/generations',
  [ENDPOINT_TYPE.OPENAI_IMAGE_EDIT]: '/images/edits'
}

export function buildEndpointRequestPreview(
  baseUrl: string,
  endpointType: EndpointType,
  pathMode?: EndpointConfig['pathMode']
): string {
  const value = baseUrl.trim()
  if (!value || !validateApiHost(value)) {
    return ''
  }

  if (pathMode === 'complete') {
    return new URL(withoutTrailingSharp(value)).toString()
  }

  const formattedHost =
    endpointType === ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT ? formatApiHost(value, true, 'v1beta') : formatApiHost(value)
  return `${formattedHost}${ENDPOINT_PATHS[endpointType] ?? ''}`
}
