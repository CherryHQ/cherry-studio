import { formatApiHost, isBareVertexApiHost, withoutTrailingSlash } from '@shared/utils/api'
import { trim } from 'es-toolkit/compat'

// Re-export from shared, for backward compatibility
export {
  formatApiHost,
  formatApiKeys,
  hasApiVersion,
  isWithTrailingSharp,
  joinApiKeyString,
  maskApiKey,
  routeToEndpoint,
  splitApiKeyString,
  withoutTrailingSharp,
  withoutTrailingSlash
} from '@shared/utils/api'

export function formatOllamaApiHost(host: string): string {
  const normalizedHost = withoutTrailingSlash(host)
    ?.replace(/\/v1$/, '')
    ?.replace(/\/api$/, '')
    ?.replace(/\/chat$/, '')
  return formatApiHost(normalizedHost + '/api', false)
}

/**
 * Build the Vertex AI host URL.
 *
 * Caller supplies the v2 source-of-truth fields directly: `apiHost` from
 * `Provider.endpointConfigs[…].baseUrl`, `project` and `location` from
 * `Provider.authConfig` (`iam-gcp` discriminator). No Redux access.
 */
export function formatVertexApiHost(input: { apiHost?: string; project: string; location: string }): string {
  const { apiHost, project, location } = input
  const trimmedHost = withoutTrailingSlash(trim(apiHost ?? ''))
  if (!trimmedHost || isBareVertexApiHost(trimmedHost)) {
    const host =
      location === 'global' ? 'https://aiplatform.googleapis.com' : `https://${location}-aiplatform.googleapis.com`
    return `${formatApiHost(host)}/projects/${project}/locations/${location}`
  }
  return formatApiHost(trimmedHost)
}

/**
 * 验证 API 主机地址是否合法。
 *
 * @param {string} apiHost - 需要验证的 API 主机地址。
 * @returns {boolean} 如果是合法的 URL 则返回 true，否则返回 false。
 */
export function validateApiHost(apiHost: string): boolean {
  // 允许apiHost为空
  if (!apiHost || !trim(apiHost)) {
    return true
  }
  try {
    const url = new URL(trim(apiHost))
    // 验证协议是否为 http 或 https
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return false
    }
    return true
  } catch {
    return false
  }
}
