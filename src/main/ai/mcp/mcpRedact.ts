// Redact potentially sensitive fields in objects (headers, tokens, api keys)
export function redactSensitive(input: any): any {
  const SENSITIVE_KEYS = ['authorization', 'Authorization', 'apiKey', 'api_key', 'apikey', 'token', 'access_token']
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
        if (SENSITIVE_KEYS.includes(k)) {
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
