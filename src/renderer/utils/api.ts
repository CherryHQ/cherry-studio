import { trim } from 'es-toolkit/compat'

import { formatApiHost, isBareVertexApiHost, withoutTrailingSlash } from '@shared/utils/api'

// Re-export from shared, for backward compatibility
export {
  formatApiHost,
  formatApiKeys,
  hasApiVersion,
  isWithTrailingSharp,
  joinApiKeyString,
  maskApiKey,
  splitApiKeyString,
  withoutTrailingSharp,
  withoutTrailingSlash
} from '@shared/utils/api'

/**
 * Normalise an Ollama base URL to exactly one `/api` suffix.
 *
 * The Ollama API is served under `/api`. A pasted base that already carries the
 * suffix — or a run of them such as `/api/api` — must collapse to a single
 * `/api`; legacy `/v1` and `/chat` suffixes are equivalent and normalise to
 * `/api` as well. Proxy mounts (e.g. `/api/ollama`, `/models/api`) are left
 * intact: only the trailing endpoint suffix is touched, and the authority (which
 * may itself end in an endpoint word, e.g. a single-label host named `api`) is
 * never consumed.
 *
 * @example
 * formatOllamaApiHost('http://localhost:11434/api') // 'http://localhost:11434/api'
 * formatOllamaApiHost('http://localhost:11434/api/api') // 'http://localhost:11434/api'
 * formatOllamaApiHost('http://localhost:11434/v1') // 'http://localhost:11434/api'
 * formatOllamaApiHost('https://proxy.example.com/api/ollama') // 'https://proxy.example.com/api/ollama/api'
 */
export function formatOllamaApiHost(host: string): string {
  const trimmed = withoutTrailingSlash(trim(host))
  // Keep the authority (scheme://host[:port]) separate so a `/api` that is part
  // of the hostname (e.g. a single-label host named `api`) is never stripped.
  const match = trimmed.match(/^([a-zA-Z][\w+.-]*:\/\/[^/]+)?(.*)$/)
  const authority = match?.[1] ?? ''
  let path = match?.[2] ?? trimmed

  // Drop a legacy trailing /v1 or /chat suffix (case-insensitive).
  path = path.replace(/\/(?:v1|chat)\/?$/i, '')

  // Collapse a trailing run of /api segments into exactly one /api; otherwise
  // append /api so the result always ends with the Ollama endpoint.
  if (/(?:\/api)+\/?$/.test(path)) {
    path = path.replace(/(?:\/api)+\/?$/, '/api')
  } else {
    path = `${path}/api`
  }

  return formatApiHost(authority + path, false)
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

// 目前对话界面只支持这些端点
export const SUPPORTED_IMAGE_ENDPOINT_LIST = ['images/generations', 'images/edits', 'predict'] as const
export const SUPPORTED_ENDPOINT_LIST = [
  'chat/completions',
  'responses',
  'messages',
  'generateContent',
  'streamGenerateContent',
  ...SUPPORTED_IMAGE_ENDPOINT_LIST
] as const

/**
 * Converts an API host URL into separate base URL and endpoint components.
 *
 * @param apiHost - The API host string to parse. Expected to be a trimmed URL that may end with '#' followed by an endpoint identifier.
 * @returns An object containing:
 *   - `baseURL`: The base URL without the endpoint suffix
 *   - `endpoint`: The matched endpoint identifier, or empty string if no match found
 *
 * @description
 * This function extracts endpoint information from a composite API host string.
 * If the host ends with '#', it attempts to match the preceding part against the supported endpoint list.
 * The '#' delimiter is removed before processing.
 *
 * @example
 * routeToEndpoint('https://api.example.com/openai/chat/completions#')
 * // Returns: { baseURL: 'https://api.example.com/v1', endpoint: 'chat/completions' }
 *
 * @example
 * routeToEndpoint('https://api.example.com/v1')
 * // Returns: { baseURL: 'https://api.example.com/v1', endpoint: '' }
 */
export function routeToEndpoint(apiHost: string): { baseURL: string; endpoint: string } {
  const trimmedHost = trim(apiHost)
  // 前面已经确保apiHost合法
  if (!trimmedHost.endsWith('#')) {
    return { baseURL: trimmedHost, endpoint: '' }
  }
  // 去掉结尾的 #
  const host = trimmedHost.slice(0, -1)
  const endpointMatch = SUPPORTED_ENDPOINT_LIST.find((endpoint) => host.endsWith(endpoint))
  if (!endpointMatch) {
    const baseURL = withoutTrailingSlash(host)
    return { baseURL, endpoint: '' }
  }
  const baseSegment = host.slice(0, host.length - endpointMatch.length)
  const baseURL = withoutTrailingSlash(baseSegment).replace(/:$/, '') // 去掉结尾可能存在的冒号(gemini的特殊情况)
  return { baseURL, endpoint: endpointMatch }
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
