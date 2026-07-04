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
      return OPEN_CODE_ENDPOINTS.map((endpoint) =>
        normalizeUrl(formatApiHost(provider.endpointConfigs?.[endpoint]?.baseUrl))
      ).filter(Boolean)
    case CodeCli.GEMINI_CLI:
      return [normalizeUrl(resolveGeminiBaseUrl(provider))].filter(Boolean)
    case CodeCli.QWEN_CODE:
    case CodeCli.KIMI_CODE:
      return [normalizeUrl(resolveOpenAIBaseUrl(provider))].filter(Boolean)
    default:
      return Object.values(provider.endpointConfigs ?? {})
        .map((config) => normalizeUrl(config?.baseUrl))
        .filter(Boolean)
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

  const validKeys = apiKeys.filter((entry) => entry.isEnabled).map((entry) => entry.key)
  return validKeys.length === 0 ? true : validKeys.includes(connection.apiKey)
}
