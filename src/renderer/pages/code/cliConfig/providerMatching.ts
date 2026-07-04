import type { ApiKeyEntry, Provider } from '@shared/data/types/provider'
import { CodeCli } from '@shared/types/codeCli'
import { formatApiHost } from '@shared/utils/api'

import { CODEX_RESPONSES_ENDPOINT, OPEN_CODE_ENDPOINTS } from './constants'
import { resolveGeminiBaseUrl, resolveOpenAIBaseUrl } from './resolvers'
import type { CliConfigConnection } from './types'
import { normalizeUrl } from './values'

function providerBaseUrls(provider: Provider, cliTool: string): string[] {
  switch (cliTool) {
    case CodeCli.CLAUDE_CODE:
      return [normalizeUrl(provider.endpointConfigs?.['anthropic-messages']?.baseUrl)].filter(Boolean)
    case CodeCli.OPENAI_CODEX:
      return [normalizeUrl(formatApiHost(provider.endpointConfigs?.[CODEX_RESPONSES_ENDPOINT]?.baseUrl))].filter(
        Boolean
      )
    case CodeCli.OPEN_CODE:
      return OPEN_CODE_ENDPOINTS.flatMap((endpoint) => {
        const baseUrl = normalizeUrl(formatApiHost(provider.endpointConfigs?.[endpoint]?.baseUrl))
        return baseUrl ? [baseUrl] : []
      })
    case CodeCli.GEMINI_CLI:
      return [normalizeUrl(resolveGeminiBaseUrl(provider))].filter(Boolean)
    case CodeCli.QWEN_CODE:
    case CodeCli.KIMI_CODE:
      return [normalizeUrl(resolveOpenAIBaseUrl(provider))].filter(Boolean)
    default: {
      const baseUrls: string[] = []
      for (const config of Object.values(provider.endpointConfigs ?? {})) {
        const baseUrl = normalizeUrl(config?.baseUrl)
        if (baseUrl) baseUrls.push(baseUrl)
      }
      return baseUrls
    }
  }
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
