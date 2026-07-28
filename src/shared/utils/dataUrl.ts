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
