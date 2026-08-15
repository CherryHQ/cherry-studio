// Sensitive environment variable keys to redact in logs (substring, case-insensitive).
// 'API-KEY' covers HTTP header names like 'X-Api-Key' alongside env-style 'X_API_KEY'.
// Bare 'KEY' catches credential names outside the API_KEY pattern (e.g. DIFY_KEY); it
// also over-redacts benign KEY-containing names, which only costs log readability.
export const SENSITIVE_ENV_KEYS = [
  'API_KEY',
  'API-KEY',
  'APIKEY',
  'KEY',
  'AUTHORIZATION',
  'TOKEN',
  'SECRET',
  'PASSWORD'
]

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
