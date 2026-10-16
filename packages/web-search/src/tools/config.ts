import { WebSearchError } from '../errors'
export function resolveApiHost(configured: string | undefined, defaultApiHost?: string): string {
  const host = (configured === undefined ? defaultApiHost : configured)?.trim()
  if (!host) throw new WebSearchError('API host is required', { kind: 'configuration', code: 'api_host_missing' })
  try {
    const url = new URL(host)
    if (url.protocol === 'http:' || url.protocol === 'https:') return host
  } catch {
    /* Validation errors must not expose the configured URL. */
  }
  throw new WebSearchError('API host must use HTTP or HTTPS', { kind: 'configuration', code: 'api_host_invalid' })
}
export function mergeApiEndpoint(apiHost: string, relativePath: string): string {
  return `${apiHost.replace(/\/+$/, '')}/${relativePath.replace(/^\/+/, '')}`
}
