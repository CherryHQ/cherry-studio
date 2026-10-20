import { resolveEndpointConnection } from '@cherrystudio/provider-registry'
import type { EndpointType } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

type ProviderConnection = Pick<Provider, 'defaultChatEndpoint' | 'endpointConfigs'>

/** Resolves connection addresses only; adapter, dialect and request path remain target-owned. */
export function resolveEndpointBaseUrl(provider: ProviderConnection, endpointType: EndpointType | undefined): string {
  const connection = resolveEndpointConnection(provider, endpointType)
  if (!connection) return ''
  if (connection.source === endpointType) return connection.baseUrl
  const route = routeToEndpoint(connection.baseUrl)
  return route.endpoint ? `${route.baseURL}#` : connection.baseUrl
}

export function routeToEndpoint(apiHost: string): { baseURL: string; endpoint: string } {
  const trimmedHost = (apiHost || '').trim()
  if (!trimmedHost.endsWith('#')) {
    return { baseURL: trimmedHost.replace(/\/+$/, ''), endpoint: '' }
  }
  const host = trimmedHost.slice(0, -1)
  const SUPPORTED_ENDPOINTS = [
    'chat/completions',
    'responses',
    'messages',
    'generateContent',
    'streamGenerateContent',
    'audio/speech',
    'images/generations',
    'images/edits',
    'predict'
  ]
  const endpointMatch = SUPPORTED_ENDPOINTS.find((ep) => host.endsWith(ep))
  if (!endpointMatch) {
    return { baseURL: host.replace(/\/+$/, ''), endpoint: '' }
  }
  const baseSegment = host.slice(0, host.length - endpointMatch.length)
  const baseURL = baseSegment.replace(/\/+$/, '').replace(/:$/, '')
  return { baseURL, endpoint: endpointMatch }
}
