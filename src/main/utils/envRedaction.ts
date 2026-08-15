// Sensitive environment variable keys to redact in logs
export const SENSITIVE_ENV_KEYS = ['API_KEY', 'APIKEY', 'AUTHORIZATION', 'TOKEN', 'SECRET', 'PASSWORD']

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
