import type { ApiKeyEntry, Provider } from '@shared/data/types/provider'
import { CLI_API_GATEWAY_PROVIDER_NAME, isApiGatewayProviderId } from '@shared/types/codeCli'

import { getAdapter } from './adapters'
import { CHERRY_PROVIDER_PREFIX } from './constants'
import type { CliConfigConnection } from './types'
import { normalizeUrl } from './values'

function providerBaseUrls(provider: Provider, cliTool: string): string[] {
  const adapter = getAdapter(cliTool)
  if (adapter) return adapter.providerBaseUrls(provider)
  const baseUrls: string[] = []
  for (const config of Object.values(provider.endpointConfigs ?? {})) {
    const baseUrl = normalizeUrl(config?.baseUrl)
    if (baseUrl) baseUrls.push(baseUrl)
  }
  return baseUrls
}

export function cliConfigConnectionMatchesProvider(
  cliTool: string,
  connection: CliConfigConnection | null,
  provider: Provider,
  apiKeys: ApiKeyEntry[] | undefined,
  expectedModel?: string
): boolean {
  if (!connection) return true
  const baseUrl = normalizeUrl(connection.baseUrl)
  if (!baseUrl) return false

  if (!providerBaseUrls(provider, cliTool).includes(baseUrl)) {
    return false
  }

  // The managed provider key is the config's own identity claim. When two
  // providers share an endpoint and model, URL/model matching alone would hide
  // a foreign configuration as "current"; the key decides.
  if (connection.providerKey) {
    const expectedProviderKey = isApiGatewayProviderId(provider.id)
      ? `${CHERRY_PROVIDER_PREFIX}${CLI_API_GATEWAY_PROVIDER_NAME}`
      : `${CHERRY_PROVIDER_PREFIX}${provider.id}`
    if (connection.providerKey !== expectedProviderKey) {
      return false
    }
  }

  if (expectedModel && connection.model !== expectedModel) {
    return false
  }

  if (!connection.apiKey) {
    return true
  }

  if (!apiKeys?.length) {
    return true
  }

  const validKeys = new Set<string>()
  for (const entry of apiKeys) {
    if (entry.isEnabled) validKeys.add(entry.key)
  }
  return validKeys.size === 0 ? true : validKeys.has(connection.apiKey)
}
