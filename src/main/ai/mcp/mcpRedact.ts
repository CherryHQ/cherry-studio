import { redactServerKey } from '@shared/utils/redaction'

// Cache keys embed the serialized server config — log them with the serverKey portion
// redacted instead of raw (same class of leak as #18648, at debug level).
export function redactCacheKey(cacheKey: string): string {
  const separator = cacheKey.indexOf(':')
  return separator === -1
    ? redactServerKey(cacheKey)
    : `${cacheKey.slice(0, separator + 1)}${redactServerKey(cacheKey.slice(separator + 1))}`
}
