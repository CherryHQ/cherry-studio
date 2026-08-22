const SENSITIVE_KEYS =
  /^(authorization|cookie|set-cookie|x-api-key|api[-_]?key|password|access[-_]?token|refresh[-_]?token)$/i

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function createRedactor(secretValues: string[]): <T>(value: T) => T {
  const secrets = secretValues.filter(Boolean).sort((left, right) => right.length - left.length)
  const patterns = secrets.map((secret) => new RegExp(escapeRegExp(secret), 'g'))

  const redact = (value: unknown, key?: string): unknown => {
    if (key && SENSITIVE_KEYS.test(key)) return '[REDACTED]'
    if (typeof value === 'string') {
      return patterns.reduce((output, pattern) => output.replace(pattern, '[REDACTED]'), value)
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
