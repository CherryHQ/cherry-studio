import { trim } from 'lodash'

import { hasAPIVersion, withoutTrailingSharp, withoutTrailingSlash } from './utils'

export * from './utils'

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
