import type { ProviderConfig } from '@earendil-works/pi-coding-agent'

type PiStreamSimple = NonNullable<ProviderConfig['streamSimple']>

/**
 * Adapt pi auth to a provider whose API key uses a provider-specific header.
 */
export function withApiKeyHeaderStream(
  config: ProviderConfig,
  apiKeyHeader: string,
  apiStreamSimple: PiStreamSimple
): ProviderConfig {
  const streamSimple: PiStreamSimple = (model, context, options) => {
    const headers = {
      ...options?.headers,
      [apiKeyHeader]: options?.apiKey ?? '',
      authorization: null,
      'x-api-key': null
    } as unknown as NonNullable<typeof options>['headers']

    return apiStreamSimple(model, context, { ...options, headers })
  }

  return { ...config, streamSimple }
}
