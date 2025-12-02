import store from '@renderer/store'
import type { VertexProvider } from '@renderer/types'
import { trim } from 'lodash'

/**
 * 格式化 API key 字符串。
 *
 * @param {string} value - 需要格式化的 API key 字符串。
 * @returns {string} 格式化后的 API key 字符串。
 */
export function formatApiKeys(value: string): string {
  return value.replaceAll('，', ',').replaceAll('\n', ',')
}

/**
 * Matches a version segment in a path that starts with `/v<number>` and optionally
 * continues with `alpha` or `beta`. The segment may be followed by `/` or the end
 * of the string (useful for cases like `/v3alpha/resources`).
 */
const VERSION_REGEX_PATTERN = '\\/v\\d+(?:alpha|beta)?(?=\\/|$)'

/**
 * Matches an API version at the end of a URL (with optional trailing slash).
 * Used to detect and extract versions only from the trailing position.
 */
const TRAILING_VERSION_REGEX = /\/v\d+(?:alpha|beta)?\/?$/i

/**
 * 判断 host 的 path 中是否包含形如版本的字符串（例如 /v1、/v2beta 等），
 *
 * @param host - 要检查的 host 或 path 字符串
 * @returns 如果 path 中包含版本字符串则返回 true，否则 false
 */
export function hasAPIVersion(host?: string): boolean {
  if (!host) return false

  const regex = new RegExp(VERSION_REGEX_PATTERN, 'i')

  try {
    const url = new URL(host)
    return regex.test(url.pathname)
  } catch {
    // 若无法作为完整 URL 解析，则当作路径直接检测
    return regex.test(host)
  }
}

/**
 * Removes the trailing slash from a URL string if it exists.
 *
 * @template T - The string type to preserve type safety
 * @param {T} url - The URL string to process
 * @returns {T} The URL string without a trailing slash
 *
 * @example
 * ```ts
 * withoutTrailingSlash('https://example.com/') // 'https://example.com'
 * withoutTrailingSlash('https://example.com')  // 'https://example.com'
 * ```
 */
export function withoutTrailingSlash<T extends string>(url: T): T {
  return url.replace(/\/$/, '') as T
}

/**
 * Removes the trailing '#' from a URL string if it exists.
 *
 * @template T - The string type to preserve type safety
 * @param {T} url - The URL string to process
 * @returns {T} The URL string without a trailing '#'
 *
 * @example
 * ```ts
 * withoutTrailingSharp('https://example.com#') // 'https://example.com'
 * withoutTrailingSharp('https://example.com')  // 'https://example.com'
 * ```
 */
export function withoutTrailingSharp<T extends string>(url: T): T {
  return url.replace(/#$/, '') as T
}

/**
 * Formats an API host URL by normalizing it and optionally appending an API version.
 *
 * @param host - The API host URL to format. Leading/trailing whitespace will be trimmed and trailing slashes removed.
 * @param supportApiVersion - Whether the API version is supported. Defaults to `true`.
 * @param apiVersion - The API version to append if needed. Defaults to `'v1'`.
 *
 * @returns The formatted API host URL. If the host is empty after normalization, returns an empty string.
 *          If the host ends with '#', API version is not supported, or the host already contains a version, returns the normalized host with trailing '#' removed.
 *          Otherwise, returns the host with the API version appended.
 *
 * @example
 * formatApiHost('https://api.example.com/') // Returns 'https://api.example.com/v1'
 * formatApiHost('https://api.example.com#') // Returns 'https://api.example.com'
 * formatApiHost('https://api.example.com/v2', true, 'v1') // Returns 'https://api.example.com/v2'
 */
export function formatApiHost(host?: string, supportApiVersion: boolean = true, apiVersion: string = 'v1'): string {
  const normalizedHost = withoutTrailingSlash(trim(host))
  if (!normalizedHost) {
    return ''
  }

  const shouldAppendApiVersion = !(normalizedHost.endsWith('#') || !supportApiVersion || hasAPIVersion(normalizedHost))

  if (shouldAppendApiVersion) {
    return `${normalizedHost}/${apiVersion}`
  } else {
    return withoutTrailingSharp(normalizedHost)
  }
}

/**
 * 格式化 Azure OpenAI 的 API 主机地址。
 */
export function formatAzureOpenAIApiHost(host: string): string {
  const normalizedHost = withoutTrailingSlash(host)
    ?.replace(/\/v1$/, '')
    .replace(/\/openai$/, '')
  // NOTE: AISDK会添加上`v1`
  return formatApiHost(normalizedHost + '/openai', false)
}

export function formatVertexApiHost(provider: VertexProvider): string {
  const { apiHost } = provider
  const { projectId: project, location } = store.getState().llm.settings.vertexai
  const trimmedHost = withoutTrailingSlash(trim(apiHost))
  if (!trimmedHost || trimmedHost.endsWith('aiplatform.googleapis.com')) {
    const host =
      location == 'global' ? 'https://aiplatform.googleapis.com' : `https://${location}-aiplatform.googleapis.com`
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

/**
 * API key 脱敏函数。仅保留部分前后字符，中间用星号代替。
 *
 * - 长度大于 24，保留前、后 8 位。
 * - 长度大于 16，保留前、后 4 位。
 * - 长度大于 8，保留前、后 2 位。
 * - 其余情况，返回原始密钥。
 *
 * @param {string} key - 需要脱敏的 API 密钥。
 * @returns {string} 脱敏后的密钥字符串。
 */
export function maskApiKey(key: string): string {
  if (!key) return ''

  if (key.length > 24) {
    return `${key.slice(0, 8)}****${key.slice(-8)}`
  } else if (key.length > 16) {
    return `${key.slice(0, 4)}****${key.slice(-4)}`
  } else if (key.length > 8) {
    return `${key.slice(0, 2)}****${key.slice(-2)}`
  } else {
    return key
  }
}

/**
 * 将 API key 字符串转换为 key 数组。
 *
 * @param {string} keyStr - 包含 API key 的逗号分隔字符串。
 * @returns {string[]} 转换后的数组，每个元素为 API key。
 */
export function splitApiKeyString(keyStr: string): string[] {
  return keyStr
    .split(/(?<!\\),/)
    .map((k) => k.trim())
    .map((k) => k.replace(/\\,/g, ','))
    .filter((k) => k)
}

/**
 * Extracts the trailing API version segment from a URL path.
 *
 * This function extracts API version patterns (e.g., `v1`, `v2beta`) from the end of a URL.
 * Only versions at the end of the path are extracted, not versions in the middle.
 * The returned version string does not include leading or trailing slashes.
 *
 * @param {string} url - The URL string to parse.
 * @returns {string | undefined} The trailing API version found (e.g., 'v1', 'v2beta'), or undefined if none found.
 *
 * @example
 * getTrailingApiVersion('https://api.example.com/v1') // 'v1'
 * getTrailingApiVersion('https://api.example.com/v2beta/') // 'v2beta'
 * getTrailingApiVersion('https://api.example.com/v1/chat') // undefined (version not at end)
 * getTrailingApiVersion('https://gateway.ai.cloudflare.com/v1/xxx/v1beta') // 'v1beta'
 * getTrailingApiVersion('https://api.example.com') // undefined
 */
export function getTrailingApiVersion(url: string): string | undefined {
  const match = url.match(TRAILING_VERSION_REGEX)

  if (match) {
    // Extract version without leading slash and trailing slash
    return match[0].replace(/^\//, '').replace(/\/$/, '')
  }

  return undefined
}

/**
 * Removes the trailing API version segment from a URL path.
 *
 * This function removes API version patterns (e.g., `/v1`, `/v2beta`) from the end of a URL.
 * Only versions at the end of the path are removed, not versions in the middle.
 *
 * @param {string} url - The URL string to process.
 * @returns {string} The URL with the trailing API version removed, or the original URL if no trailing version found.
 *
 * @example
 * withoutTrailingApiVersion('https://api.example.com/v1') // 'https://api.example.com'
 * withoutTrailingApiVersion('https://api.example.com/v2beta/') // 'https://api.example.com'
 * withoutTrailingApiVersion('https://api.example.com/v1/chat') // 'https://api.example.com/v1/chat' (no change)
 * withoutTrailingApiVersion('https://api.example.com') // 'https://api.example.com'
 */
export function withoutTrailingApiVersion(url: string): string {
  return url.replace(TRAILING_VERSION_REGEX, '')
}
