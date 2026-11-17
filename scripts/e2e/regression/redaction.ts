const SENSITIVE_KEYS =
  /^(authorization|cookie|set-cookie|x-api-key|api[-_]?key|password|access[-_]?token|refresh[-_]?token)$/i
const BEARER_SECRET = /(\bBearer\s+)[A-Za-z0-9._~+/=-]+/gi
const QUERY_SECRET = /([?&](?:code|state|code_verifier|api[-_]?key|access[-_]?token|refresh[-_]?token)=)[^&\s"'<>]+/gi
const NAMED_SECRET_ASSIGNMENT =
  /(\b(?:authorization|cookie|set-cookie|x-api-key|api[-_]?keys?|password|access[-_]?tokens?|refresh[-_]?tokens?)\b["']?\s*[:=]\s*)(["']?)([^'"\s,}\]]+)\2/gi
const LONG_GENERIC_KEY_ASSIGNMENT = /(\bkey\b["']?\s*:\s*)(["'])([^'"]{20,})\2/gi

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function createRedactor(secretValues: string[]): <T>(value: T) => T {
  const secrets = secretValues.filter(Boolean).sort((left, right) => right.length - left.length)
  const patterns = secrets.map((secret) => new RegExp(escapeRegExp(secret), 'g'))

  const redact = (value: unknown, key?: string): unknown => {
    if (key && SENSITIVE_KEYS.test(key)) return '[REDACTED]'
    if (typeof value === 'string') {
      const configuredSecretsRemoved = patterns.reduce(
        (output, pattern) => output.replace(pattern, '[REDACTED]'),
        value
      )
      return configuredSecretsRemoved
        .replace(BEARER_SECRET, '$1[REDACTED]')
        .replace(QUERY_SECRET, '$1[REDACTED]')
        .replace(NAMED_SECRET_ASSIGNMENT, '$1$2[REDACTED]$2')
        .replace(LONG_GENERIC_KEY_ASSIGNMENT, '$1$2[REDACTED]$2')
    }
    if (Array.isArray(value)) return value.map((item) => redact(item))
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redact(entryValue, entryKey)])
      )
    }
    return value
  }

  return <T>(value: T) => redact(value) as T
}
