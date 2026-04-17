import { parse as jsoncParse } from 'jsonc-parser'

export * from './api'
export * from './pdf'

export const defaultAppHeaders = () => {
  return {
    'HTTP-Referer': 'https://cherry-ai.com',
    'X-Title': 'Cherry Studio'
  }
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

// === JSONC Parsing Utilities ===

// Sensitive environment variable keys to redact in logs
export const SENSITIVE_ENV_KEYS = ['API_KEY', 'APIKEY', 'AUTHORIZATION', 'TOKEN', 'SECRET', 'PASSWORD']

// Keys that don't represent functional configuration content
export const NON_FUNCTIONAL_KEYS = ['$schema']

/**
 * Parse JSON with comments (JSONC) support
 * Uses jsonc-parser library for safe parsing without code execution
 */
export function parseJSONC(content: string): Record<string, any> | null {
  try {
    const result = jsoncParse(content, undefined, {
      allowTrailingComma: true,
      disallowComments: false
    })
    return result && typeof result === 'object' ? result : null
  } catch {
    return null
  }
}

/**
 * Get functional keys from a config object (excluding non-functional keys like $schema)
 */
export function getFunctionalKeys(obj: Record<string, any>): string[] {
  return Object.keys(obj).filter((key) => !NON_FUNCTIONAL_KEYS.includes(key))
}

/**
 * Sanitize environment variables for safe logging
 * Redacts values of sensitive keys to prevent credential leakage
 */
export function sanitizeEnvForLogging(env: Record<string, string>): Record<string, string> {
  const sanitized: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    const isSensitive = SENSITIVE_ENV_KEYS.some((k) => key.toUpperCase().includes(k))
    sanitized[key] = isSensitive ? '<redacted>' : value
  }
  return sanitized
}
