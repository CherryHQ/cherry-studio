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
  apiKeys: ApiKeyEntry[] | undefined
): boolean {
  if (!connection) return true
  const baseUrlMatches =
    !connection.baseUrl || providerBaseUrls(provider, cliTool).includes(normalizeUrl(connection.baseUrl))
  const apiKeyMatches =
    !connection.apiKey || apiKeys === undefined || apiKeys.some((entry) => entry.key === connection.apiKey)
  return baseUrlMatches && apiKeyMatches
}
