import { createHash } from 'node:crypto'

import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'

import type { SdkConfig } from './sdkConfig'

export function getReplayRouteId(
  connectionId: string,
  endpointType: EndpointType | undefined,
  config: SdkConfig
): string {
  const settings = config.providerSettings
  const configuredUrl =
    endpointType === ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT && 'geminiBaseURL' in settings && settings.geminiBaseURL
      ? settings.geminiBaseURL
      : 'baseURL' in settings
        ? settings.baseURL
        : undefined
  const url = typeof configuredUrl === 'string' ? URL.parse(configuredUrl) : null
  const route = [
    connectionId,
    endpointType,
    config.providerId,
    config.modelId,
    url?.origin,
    url?.pathname.replace(/\/+$/, ''),
    url?.searchParams.get('api-version'),
    'project' in settings ? settings.project : undefined,
    'location' in settings ? settings.location : undefined
  ]
  return createHash('sha256').update(JSON.stringify(route)).digest('hex')
}
