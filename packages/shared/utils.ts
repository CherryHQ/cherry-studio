import { normalizeHeaders, withUserAgentSuffix } from '@ai-sdk/provider-utils'

export const defaultAppHeaders = () => {
  return {
    'HTTP-Referer': 'https://cherry-ai.com',
    'X-Title': 'Cherry Studio'
  }
}

/**
 * 合并多个 headers 对象，自动标准化大小写
 *
 * @param headerSets - headers 集合（按顺序合并，后者覆盖前者，但 User-Agent 会追加）
 * @returns 合并后的 headers（键全部小写）
 *
 * @example
 * ```typescript
 * const result = mergeHeaders(
 *   { 'User-Agent': 'DefaultAgent', 'X-Custom': 'value1' },
 *   { 'user-agent': 'CustomSuffix', 'X-Custom': 'value2' }
 * )
 * // result: { 'user-agent': 'DefaultAgent CustomSuffix', 'x-custom': 'value2' }
 * ```
 */
export function mergeHeaders(
  ...headerSets: Array<HeadersInit | Record<string, string | undefined> | undefined>
): Record<string, string> {
  const { result, userAgents } = headerSets.reduce(
    (acc, headerSet) => {
      const headers = new Headers(normalizeHeaders(headerSet))

      const ua = headers.get('user-agent')
      if (ua) {
        acc.userAgents.push(ua)
        headers.delete('user-agent')
      }

      headers.forEach((value, key) => acc.result.set(key, value))
      return acc
    },
    { result: new Headers(), userAgents: [] as string[] }
  )

  return userAgents.length > 0 ? withUserAgentSuffix(result, ...userAgents) : Object.fromEntries(result.entries())
}

// Following two function are not being used for now.
// I may use them in the future, so just keep them commented. - by eurfelux

/**
 * Converts an `undefined` value to `null`, otherwise returns the value as-is.
 * @param value - The value to check
 * @returns `null` if the input is `undefined`; otherwise the input value
 */

// export function toNullIfUndefined<T>(value: T | undefined): T | null {
//   if (value === undefined) {
//     return null
//   } else {
//     return value
//   }
// }

/**
 * Converts a `null` value to `undefined`, otherwise returns the value as-is.
 * @param value - The value to check
 * @returns `undefined` if the input is `null`; otherwise the input value
 */

// export function toUndefinedIfNull<T>(value: T | null): T | undefined {
//   if (value === null) {
//     return undefined
//   } else {
//     return value
//   }
// }

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
 * Matches an API version at the end of a URL (with optional trailing slash).
 * Used to detect and extract versions only from the trailing position.
 */
const TRAILING_VERSION_REGEX = /\/v\d+(?:alpha|beta)?\/?$/i

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

export interface DataUrlParts {
  /** The media type (e.g., 'image/png', 'text/plain') */
  mediaType?: string
  /** Whether the data is base64 encoded */
  isBase64: boolean
  /** The data portion (everything after the comma). This is the raw string, not decoded. */
  data: string
}

/**
 * Parses a data URL into its component parts without using regex on the data portion.
 * This is memory-safe for large data URLs (e.g., 4K images) as it uses indexOf instead of regex.
 *
 * Data URL format: data:[<mediatype>][;base64],<data>
 *
 * @param url - The data URL string to parse
 * @returns DataUrlParts if valid, null if invalid
 *
 * @example
 * parseDataUrl('data:image/png;base64,iVBORw0KGgo...')
 * // { mediaType: 'image/png', isBase64: true, data: 'iVBORw0KGgo...' }
 *
 * parseDataUrl('data:text/plain,Hello')
 * // { mediaType: 'text/plain', isBase64: false, data: 'Hello' }
 *
 * parseDataUrl('invalid-url')
 * // null
 */
export function parseDataUrl(url: string): DataUrlParts | null {
  if (!url.startsWith('data:')) {
    return null
  }

  const commaIndex = url.indexOf(',')
  if (commaIndex === -1) {
    return null
  }

  const header = url.slice(5, commaIndex)

  const isBase64 = header.includes(';base64')

  const semicolonIndex = header.indexOf(';')
  const mediaType = (semicolonIndex === -1 ? header : header.slice(0, semicolonIndex)).trim() || undefined

  const data = url.slice(commaIndex + 1)

  return { mediaType, isBase64, data }
}

/**
 * Checks if a string is a data URL.
 *
 * @param url - The string to check
 * @returns true if the string is a valid data URL
 */
export function isDataUrl(url: string): boolean {
  return url.startsWith('data:') && url.includes(',')
}

/**
 * Checks if a data URL contains base64-encoded image data.
 *
 * @param url - The data URL to check
 * @returns true if the URL is a base64-encoded image data URL
 */
export function isBase64ImageDataUrl(url: string): boolean {
  if (!url.startsWith('data:image/')) {
    return false
  }
  const commaIndex = url.indexOf(',')
  if (commaIndex === -1) {
    return false
  }
  const header = url.slice(5, commaIndex)
  return header.includes(';base64')
}
