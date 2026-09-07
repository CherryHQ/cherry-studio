// Single source of secret redaction for logs, traces, and diagnostics.
// Shared by main and renderer; everything here is pure — no runtime state.

export const REDACTED = '<redacted>'

// Substring stems matched against key names, case-insensitively; they subsume the
// historic API_KEY/APIKEY/PASSWORD variants (over-matching only costs log readability).
export const SENSITIVE_KEY_STEMS = ['KEY', 'TOKEN', 'SECRET', 'AUTH', 'CREDENTIAL', 'PASS', 'COOKIE', 'SESSION']

// Exact names (lowercase) that no stem covers; dropping them would regress
// header redaction (httpTraceFetch's former list).
export const SENSITIVE_KEY_EXACT = ['openai-organization', 'openai-project']

export function isSensitiveKey(key: string): boolean {
  const upper = key.toUpperCase()
  return SENSITIVE_KEY_STEMS.some((stem) => upper.includes(stem)) || SENSITIVE_KEY_EXACT.includes(key.toLowerCase())
}

/** Shallow redaction of a flat string map (env vars, headers). */
export function redactRecord(record: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(record)) {
    out[key] = isSensitiveKey(key) ? REDACTED : value
  }
  return out
}

const MAX_STRING = 300

/**
 * Deep redaction of nested objects for logging/diagnostics: sensitive keys by
 * name, long strings truncated, circular graphs short-circuited.
 */
export function redactDeep(value: unknown): unknown {
  const redact = (val: any, seen: WeakSet<object>): any => {
    if (val == null) return val
    if (typeof val === 'string') {
      return val.length > MAX_STRING ? `${val.slice(0, MAX_STRING)}…<${val.length - MAX_STRING} more>` : val
    }
    if (typeof val !== 'object') return val
    if (seen.has(val)) return '[Circular]'
    seen.add(val)
    if (Array.isArray(val)) return val.map((v) => redact(v, seen))
    const out: Record<string, any> = {}
    for (const [k, v] of Object.entries(val)) {
      out[k] = isSensitiveKey(k) ? REDACTED : redact(v, seen)
    }
    return out
  }
  return redact(value, new WeakSet())
}

/**
 * Redact secrets from a serialized serverKey (JSON of an MCP server config);
 * a parse failure yields a placeholder instead of the raw string.
 * env/headers fail CLOSED: every value is redacted — secrecy cannot be
 * inferred from key names (e.g. DATABASE_URL carries credentials in the
 * value while matching no sensitive name).
 */
export function redactServerKey(serverKey: string): string {
  const redactAllValues = (value: unknown): unknown =>
    typeof value === 'object' && value !== null
      ? Object.fromEntries(Object.keys(value).map((key) => [key, REDACTED]))
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

const SCHEME_URL_RE = /^[a-z][a-z\d+.-]*:\/\//i

/**
 * Redact a configured URL to routing information only — origin + pathname;
 * credentials, query tokens, and fragments never survive.
 */
export function redactUrlToOrigin(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return 'configured'

  if (SCHEME_URL_RE.test(trimmed)) {
    try {
      const url = new URL(trimmed)
      if (!url.host) return 'configured'
      return `${url.protocol}//${url.host}`
    } catch {
      return 'configured'
    }
  }

  const authority = trimmed.replace(/^\/\//, '').split(/[/?#]/, 1)[0]
  const host = authority.slice(authority.lastIndexOf('@') + 1)

  if (!host || /\s/.test(host)) return 'configured'

  try {
    const url = new URL(`http://${host}`)
    return url.host || 'configured'
  } catch {
    return 'configured'
  }
}

/**
 * Keep the URL structure but replace userinfo credentials and sensitive query
 * parameter values. `extraKeys` (lowercase, exact) extends the stem match for
 * scope-limited names like OAuth's `code` that must never redact JSON keys
 * globally. Malformed input is returned untouched.
 */
export function redactUrlParams(rawUrl: string, extraKeys: readonly string[] = []): string {
  try {
    const url = new URL(rawUrl)
    if (url.username) url.username = REDACTED
    if (url.password) url.password = REDACTED
    for (const key of [...url.searchParams.keys()]) {
      if (isSensitiveKey(key) || extraKeys.includes(key.toLowerCase())) {
        url.searchParams.set(key, REDACTED)
      }
    }
    return url.toString()
  } catch {
    return rawUrl
  }
}

// Curated alternation (not the bare stems — those over-match English words); ordering
// and value-alternative rationale lives with the edge-case tests in redaction.test.ts.
const SECRET_KEY_VALUE_PATTERN =
  /(["']?(?:api[_-]?key|apikey|token|secret|password|passphrase|auth|credential|cookie|session)\w*["']?\s*[:=]\s*)("""[\s\S]*?"""|'''[\s\S]*?'''|[^\r\n]*)/gi

// Bearer/Basic must run before the key=value pass — see the tests for why.
const BEARER_SCHEME_PATTERN = /\b(Bearer|Basic)\s+("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s"',;}\]]+)/gi

/**
 * Redact likely-secret fragments embedded in free text: `key = value`,
 * `"key": value`, and `Bearer <token>` schemes. `extraKeys` extends the key
 * alternation for scope-limited names like OAuth's `code`.
 */
export function redactSecretText(text: string, extraKeys: readonly string[] = []): string {
  // Escape each extra key — raw insertion of regex metacharacters would silently break the alternation.
  const escaped = extraKeys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const withExtras =
    escaped.length === 0
      ? SECRET_KEY_VALUE_PATTERN
      : new RegExp(SECRET_KEY_VALUE_PATTERN.source.replace('|apikey', `|apikey|${escaped.join('|')}`), 'gi')
  return text.replace(BEARER_SCHEME_PATTERN, `$1 ${REDACTED}`).replace(withExtras, `$1"${REDACTED}"`)
}

/** Redact an exact runtime-known secret literal wherever it occurs. */
export function redactLiteral(text: string, secret: string | undefined): string {
  if (!secret) return text
  return text.split(secret).join(REDACTED)
}
