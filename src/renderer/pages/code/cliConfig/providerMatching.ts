import type { ApiKeyEntry, Provider } from '@shared/data/types/provider'
import { CodeCli } from '@shared/types/codeCli'

import { resolveGeminiBaseUrl } from './resolvers'
import type { CliConfigConnection } from './types'
import { normalizeUrl } from './values'

function providerBaseUrls(provider: Provider, cliTool: string): string[] {
  const urls = Object.values(provider.endpointConfigs ?? {})
    .map((config) => normalizeUrl(config?.baseUrl))
    .filter(Boolean)

  if (cliTool === CodeCli.GEMINI_CLI) {
    const geminiBaseUrl = normalizeUrl(resolveGeminiBaseUrl(provider))
    if (geminiBaseUrl && !urls.includes(geminiBaseUrl)) {
      urls.push(geminiBaseUrl)
    }
  }

  return urls
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

  const validKeys = apiKeys.filter((entry) => entry.isEnabled).map((entry) => entry.key)
  return validKeys.length === 0 ? true : validKeys.includes(connection.apiKey)
}
