import type { Provider } from '@shared/data/types/provider'
import { isApiGatewayProviderId } from '@shared/types/codeCli'
import { withoutTrailingSlash } from '@shared/utils/api'

const GEMINI_AGGREGATOR_BASE_URLS: Readonly<Record<string, string>> = {
  aihubmix: 'https://aihubmix.com/gemini'
}

/** Resolve the Gemini-compatible base URL shared by file config and session launch. */
export function resolveGeminiBaseUrl(provider: Provider): string {
  // The synthetic API-gateway provider serves every dialect off one bare host
  // (http://host:port) but deliberately declares NO google-generate-content
  // endpoint: OPEN_CODE_ENDPOINTS lists google first, so adding one would flip
  // OpenCode+gateway to the google dialect for every model. The @google/genai SDK
  // appends /v1beta itself, so return the bare host here.
  if (isApiGatewayProviderId(provider.id)) {
    const configs = provider.endpointConfigs ?? {}
    return configs['anthropic-messages']?.baseUrl ?? Object.values(configs)[0]?.baseUrl ?? ''
  }

  const dedicated = provider.endpointConfigs?.['google-generate-content']?.baseUrl
  if (dedicated) return dedicated

  const chatBaseUrl = provider.defaultChatEndpoint
    ? provider.endpointConfigs?.[provider.defaultChatEndpoint]?.baseUrl
    : undefined
  // Aggregators serving Gemini under a /gemini sub-path (aihubmix): derive from
  // the user-configured chat baseUrl — dropping a trailing /v1 — so a custom
  // mirror host wins; the static default applies only when nothing is configured.
  if (GEMINI_AGGREGATOR_BASE_URLS[provider.id]) {
    if (!chatBaseUrl) return GEMINI_AGGREGATOR_BASE_URLS[provider.id]
    return `${withoutTrailingSlash(chatBaseUrl).replace(/\/v1$/, '')}/gemini`
  }
  // Aggregators allow-listed for Gemini-compatible CLIs (CLI_TOOL_PROVIDER_MAP) without a
  // dedicated google-generate-content endpoint or an entry above (e.g. CherryIN, DMXAPI)
  // proxy every protocol off the same host as their default chat endpoint — mirrors the
  // fallback buildCherryinConfig/dmxapiProvider.ts already rely on for real chat requests.
  return chatBaseUrl || ''
}
