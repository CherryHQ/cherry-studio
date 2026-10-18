import { WEB_SEARCH_PROVIDER_CATALOG } from './catalog'
import type { WebSearchCall, WebSearchValidationIssue } from './types'

export function isHttpUrl(input: string): boolean {
  try {
    const url = new URL(input)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function resolveApiHost(call: WebSearchCall): string {
  const metadata = Object.prototype.hasOwnProperty.call(WEB_SEARCH_PROVIDER_CATALOG, call.providerId)
    ? WEB_SEARCH_PROVIDER_CATALOG[call.providerId]
    : undefined
  return (
    call.config.apiHost ??
    metadata?.capabilities.find((item) => item.capability === call.capability)?.defaultApiHost ??
    ''
  ).trim()
}

export function validateWebSearchCall(call: WebSearchCall): readonly WebSearchValidationIssue[] {
  const issues: WebSearchValidationIssue[] = []
  const add = (code: string, path: string[], message: string) => issues.push({ code, path, message })
  const metadata = Object.prototype.hasOwnProperty.call(WEB_SEARCH_PROVIDER_CATALOG, call.providerId)
    ? WEB_SEARCH_PROVIDER_CATALOG[call.providerId]
    : undefined
  const capability = metadata?.capabilities.find((item) => item.capability === call.capability)
  if (!capability) add('capability_unsupported', ['capability'], 'The provider does not support this capability')
  const host = resolveApiHost(call)
  if (!host) add('api_host_missing', ['config', 'apiHost'], 'An API host is required')
  else if (!isHttpUrl(host)) add('api_host_invalid', ['config', 'apiHost'], 'The API host must be an HTTP(S) URL')
  if (
    typeof call.input !== 'string' ||
    !call.input.trim() ||
    (call.capability === 'fetchUrls' && !isHttpUrl(call.input))
  ) {
    add('input_invalid', ['input'], 'A non-empty query or valid HTTP(S) page URL is required')
  }
  if (capability?.apiKey === 'required' && !call.credentials?.apiKey?.trim()) {
    add('api_key_missing', ['credentials', 'apiKey'], 'An API key is required')
  }
  if (call.timeoutMs !== undefined && (!Number.isFinite(call.timeoutMs) || call.timeoutMs <= 0)) {
    add('input_invalid', ['timeoutMs'], 'The timeout must be a positive number')
  }
  if (call.capability === 'searchKeywords') {
    if (!Number.isInteger(call.config.maxResults) || call.config.maxResults <= 0) {
      add('input_invalid', ['config', 'maxResults'], 'maxResults must be a positive integer')
    }
    if (call.config.engines?.length && call.providerId !== 'searxng') {
      add('option_unsupported', ['config', 'engines'], 'Only SearXNG supports engines')
    }
    if (call.config.excludeDomains?.length && !['bocha', 'querit'].includes(call.providerId)) {
      add('option_unsupported', ['config', 'excludeDomains'], 'This provider does not support domain exclusions')
    }
  } else if (call.config.maxCharacters !== undefined) {
    if (call.providerId !== 'exa-mcp')
      add('option_unsupported', ['config', 'maxCharacters'], 'Only Exa MCP supports maxCharacters')
    if (!Number.isInteger(call.config.maxCharacters) || call.config.maxCharacters <= 0) {
      add('input_invalid', ['config', 'maxCharacters'], 'maxCharacters must be a positive integer')
    }
  }
  return issues
}
