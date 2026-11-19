import type { ApiKeyEntry, Provider } from '@shared/data/types/provider'

import { getAdapter } from './adapters'
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
