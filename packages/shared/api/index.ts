/**
 * Shared API Utilities
 *
 * Common utilities for API URL formatting and validation.
 * Used by both main process (API Server) and renderer.
 */

import type { MinimalProvider } from '@shared/provider'
import { trim } from 'lodash'

// Supported endpoints for routing
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
 * Removes the trailing slash from a URL string if it exists.
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
 * 格式化 Azure OpenAI 的 API 主机地址。
 */
export function formatAzureOpenAIApiHost(host: string): string {
  const normalizedHost = withoutTrailingSlash(host)
    ?.replace(/\/v1$/, '')
    .replace(/\/openai$/, '')
  // NOTE: AISDK会添加上`v1`
  return formatApiHost(normalizedHost + '/openai', false)
}

export function formatVertexApiHost(
  provider: MinimalProvider,
  project: string = 'test-project',
  location: string = 'us-central1'
): string {
  const { apiHost } = provider
  const trimmedHost = withoutTrailingSlash(trim(apiHost))
  if (!trimmedHost || trimmedHost.endsWith('aiplatform.googleapis.com')) {
    const host =
      location === 'global' ? 'https://aiplatform.googleapis.com' : `https://${location}-aiplatform.googleapis.com`
    return `${formatApiHost(host)}/projects/${project}/locations/${location}`
  }
  return formatApiHost(trimmedHost)
}

/**
 * 格式化 Ollama 的 API 主机地址。
 */
export function formatOllamaApiHost(host: string): string {
  const normalizedHost = withoutTrailingSlash(host)
    ?.replace(/\/v1$/, '')
    ?.replace(/\/api$/, '')
    ?.replace(/\/chat$/, '')
  return formatApiHost(normalizedHost + '/api', false)
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
 * Converts an API host URL into separate base URL and endpoint components.
 *
 * This function extracts endpoint information from a composite API host string.
 * If the host ends with '#', it attempts to match the preceding part against the supported endpoint list.
 *
 * @param apiHost - The API host string to parse
 * @returns An object containing:
 *   - `baseURL`: The base URL without the endpoint suffix
 *   - `endpoint`: The matched endpoint identifier, or empty string if no match found
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
  const trimmedHost = (apiHost || '').trim()
  if (!trimmedHost.endsWith('#')) {
    return { baseURL: trimmedHost, endpoint: '' }
  }
  // Remove trailing #
  const host = trimmedHost.slice(0, -1)
  const endpointMatch = SUPPORTED_ENDPOINT_LIST.find((endpoint) => host.endsWith(endpoint))
  if (!endpointMatch) {
    const baseURL = withoutTrailingSlash(host)
    return { baseURL, endpoint: '' }
  }
  const baseSegment = host.slice(0, host.length - endpointMatch.length)
  const baseURL = withoutTrailingSlash(baseSegment).replace(/:$/, '') // Remove trailing colon (gemini special case)
  return { baseURL, endpoint: endpointMatch }
}

/**
 * Gets the AI SDK compatible base URL from a provider's apiHost.
 *
 * AI SDK expects baseURL WITH version suffix (e.g., /v1).
 * This function:
 * 1. Handles '#' endpoint routing format
 * 2. Ensures the URL has a version suffix (adds /v1 if missing)
 *
 * @param apiHost - The provider's apiHost value (may or may not have /v1)
 * @param apiVersion - The API version to use if missing. Defaults to 'v1'.
 * @returns The baseURL suitable for AI SDK (with version suffix)
 *
 * @example
 * getAiSdkBaseUrl('https://api.openai.com') // 'https://api.openai.com/v1'
 * getAiSdkBaseUrl('https://api.openai.com/v1') // 'https://api.openai.com/v1'
 * getAiSdkBaseUrl('https://api.example.com/chat/completions#') // 'https://api.example.com'
 */
export function getAiSdkBaseUrl(apiHost: string, apiVersion: string = 'v1'): string {
  // First handle '#' endpoint routing format
  const { baseURL } = routeToEndpoint(apiHost)

  // If already has version, return as-is
  if (hasAPIVersion(baseURL)) {
    return withoutTrailingSlash(baseURL)
  }

  // Add version suffix
  return `${withoutTrailingSlash(baseURL)}/${apiVersion}`
}

/**
 * Validates an API host address.
 *
 * @param apiHost - The API host address to validate
 * @returns true if valid URL with http/https protocol, false otherwise
 */
export function validateApiHost(apiHost: string): boolean {
  if (!apiHost || !apiHost.trim()) {
    return true // Allow empty
  }
  try {
    const url = new URL(apiHost.trim())
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
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
