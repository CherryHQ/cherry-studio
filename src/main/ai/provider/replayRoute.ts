import { createHash } from 'node:crypto'

import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'

import type { SdkConfig } from './sdkConfig'

export function getReplayRouteId(
  connectionId: string,
  endpointType: EndpointType | undefined,
  config: SdkConfig
): string {
  const settings = config.providerSettings
  const geminiUrl =
    endpointType === ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT && 'geminiBaseURL' in settings
      ? settings.geminiBaseURL
      : undefined
  const anthropicUrl =
    endpointType === ENDPOINT_TYPE.ANTHROPIC_MESSAGES && 'anthropicBaseURL' in settings
      ? settings.anthropicBaseURL
      : undefined
  const endpointUrl =
    endpointType && 'endpointBaseURLs' in settings ? settings.endpointBaseURLs?.[endpointType] : undefined
  const configuredUrl =
    geminiUrl || anthropicUrl || endpointUrl || ('baseURL' in settings ? settings.baseURL : undefined)
  const url = typeof configuredUrl === 'string' ? URL.parse(configuredUrl) : null
  const route = [
    connectionId,
    endpointType,
    config.providerId,
    config.modelId,
    url?.origin,
    url?.pathname.replace(/\/+$/, ''),
    url?.searchParams.get('api-version') ?? ('apiVersion' in settings ? settings.apiVersion : undefined),
    'project' in settings ? settings.project : undefined,
    'location' in settings ? settings.location : undefined
  ]
  return createHash('sha256').update(JSON.stringify(route)).digest('hex')
}
