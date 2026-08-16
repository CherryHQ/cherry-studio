import { SENSITIVE_ENV_KEYS } from '@main/utils/envRedaction'

// Redact potentially sensitive fields in objects (headers, tokens, api keys)
export function redactSensitive(input: any): any {
  const MAX_STRING = 300

  // Track visited objects so a circular graph (e.g. an Error with an assigned `cause`,
  // or HTTP request<->response cross-references) can't drive unbounded recursion → stack
  // overflow inside the logger. This runs on caught Errors and server-controlled payloads.
  const redact = (val: any, seen: WeakSet<object>): any => {
    if (val == null) return val
    if (typeof val === 'string') {
      return val.length > MAX_STRING ? `${val.slice(0, MAX_STRING)}…<${val.length - MAX_STRING} more>` : val
    }
    if (typeof val === 'object') {
      if (seen.has(val)) return '[Circular]'
      seen.add(val)
    }
    if (Array.isArray(val)) return val.map((v) => redact(v, seen))
    if (typeof val === 'object') {
      const out: Record<string, any> = {}
      for (const [k, v] of Object.entries(val)) {
        if (SENSITIVE_ENV_KEYS.some((sk) => k.toUpperCase().includes(sk))) {
          out[k] = '<redacted>'
        } else {
          out[k] = redact(v, seen)
        }
      }
      return out
    }
    return val
  }

  return redact(input, new WeakSet())
}

// Strip secrets from a serialized serverKey (see getServerKey) before logging; a serverKey
// that fails to parse yields a placeholder rather than the raw string.
// env/headers fail CLOSED: every value is redacted — secrecy cannot be inferred from key
// names (e.g. DATABASE_URL carries credentials in the value, matching no sensitive name).
export function redactServerKey(serverKey: string): string {
  const redactAllValues = (value: unknown): unknown =>
    typeof value === 'object' && value !== null
      ? Object.fromEntries(Object.keys(value).map((key) => [key, '<redacted>']))
      : value
  try {
    const parsed = JSON.parse(serverKey) as Record<string, unknown>
    parsed.env = redactAllValues(parsed.env)
    parsed.headers = redactAllValues(parsed.headers)
    return JSON.stringify(parsed)
  } catch {
    return '<unparseable-serverKey>'
  }
}

// Cache keys embed the serialized server config — log them with the serverKey portion
// redacted instead of raw (same class of leak as #18648, at debug level).
export function redactCacheKey(cacheKey: string): string {
  const separator = cacheKey.indexOf(':')
  return separator === -1
    ? redactServerKey(cacheKey)
    : `${cacheKey.slice(0, separator + 1)}${redactServerKey(cacheKey.slice(separator + 1))}`
}
