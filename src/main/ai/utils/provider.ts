import { providerService } from '@data/services/ProviderService'
import type { Provider } from '@shared/data/types/provider'
import { defaultAppHeaders } from '@shared/utils'

export function getBaseUrl(provider: Provider): string {
  const ep = provider.defaultChatEndpoint
  if (ep && provider.endpointConfigs?.[ep]?.baseUrl) {
    return provider.endpointConfigs[ep].baseUrl
  }

  if (provider.endpointConfigs) {
    for (const config of Object.values(provider.endpointConfigs)) {
      if (config?.baseUrl) return config.baseUrl
    }
  }
  return ''
}

export function getExtraHeaders(provider: Provider): Record<string, string> {
  return provider.settings?.extraHeaders ?? {}
}

export async function defaultHeaders(provider: Provider): Promise<Record<string, string>> {
  const apiKey = await providerService.getRotatedApiKey(provider.id)
  return {
    ...defaultAppHeaders(),
    ...(apiKey ? { Authorization: `Bearer ${apiKey}`, 'X-Api-Key': apiKey } : {}),
    ...getExtraHeaders(provider)
  }
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
