/**
 * Matches an API version at the end of a URL (with optional trailing slash).
 * Used to detect and extract versions only from the trailing position.
 */
const TRAILING_VERSION_REGEX = /\/v\d+(?:alpha|beta)?\/?$/i

/**
 * Matches a version segment in a path that starts with `/v<number>` and optionally
 * continues with `alpha` or `beta`. The segment may be followed by `/` or the end
 * of the string (useful for cases like `/v3alpha/resources`).
 */
const VERSION_REGEX = /\/v\d+(?:alpha|beta)?(?:\/|$)/i

/**
 * Formats an API key string.
 *
 * @param {string} value - The API key string to format.
 * @returns {string} The formatted API key string.
 */
export function formatApiKeys(value: string): string {
  return value.replaceAll('，', ',').replaceAll('\n', ',')
}

/**
 * Determines whether a host or path string contains a version-like segment (e.g., /v1, /v2beta).
 *
 * @param host - The host or path string to check.
 * @returns True if the path contains a version string, false otherwise.
 */
export function hasAPIVersion(host?: string): boolean {
  if (!host) return false

  try {
    const url = new URL(host)
    return VERSION_REGEX.test(url.pathname)
  } catch {
    // If the input cannot be parsed as a full URL, treat it as a path and test directly.
    return VERSION_REGEX.test(host)
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

/**
 * Removes the trailing slash from a URL string if it exists.
 *
 * @param url - The URL string to process
 * @returns The URL string without a trailing slash
 *
 * @example
 * ```ts
 * withoutTrailingSlash('https://example.com/') // 'https://example.com'
 * withoutTrailingSlash('https://example.com')  // 'https://example.com'
 * ```
 */
export function withoutTrailingSlash(url: string): string {
  return url.replace(/\/$/, '')
}

/**
 * Checks if a URL string ends with a trailing '#' character.
 *
 * @template T - The string type to preserve type safety
 * @param {T} url - The URL string to check
 * @returns {boolean} True if the URL ends with '#', false otherwise
 *
 * @example
 * ```ts
 * isWithTrailingSharp('https://example.com#') // true
 * isWithTrailingSharp('https://example.com')  // false
 * ```
 */
export function isWithTrailingSharp<T extends string>(url: T): boolean {
  return url.endsWith('#')
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
