// Sensitive environment variable keys to redact in logs (substring, case-insensitive).
// Entries are minimal stems: 'KEY' subsumes API_KEY/APIKEY/DIFY_KEY and header-style
// 'X-Api-Key'; 'AUTH' subsumes AUTHORIZATION/BASIC_AUTH; 'PASS' subsumes
// PASSWORD/PASSPHRASE/SSHPASS. Substring matching over-redacts benign names
// (AUTHOR_NAME, XDG_SESSION_TYPE, COMPASS_DIR) — log readability is the only cost.
export const SENSITIVE_ENV_KEYS = ['KEY', 'TOKEN', 'SECRET', 'AUTH', 'CREDENTIAL', 'PASS', 'COOKIE', 'SESSION']

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
