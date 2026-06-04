import { loggerService } from '@logger'

const logger = loggerService.withContext('OutputSanitizer')

const REDACTED = '[REDACTED]'

/**
 * Patterns that match common secret/credential formats.
 * Each pattern replaces the match with [REDACTED] to prevent
 * accidental leakage of sensitive data through channel responses.
 */
const SECRET_PATTERNS: Array<{ name: string; re: RegExp }> = [
  // PEM private keys (RSA, EC, generic)
  {
    name: 'pem-private-key',
    re: /-----BEGIN\s+(?:RSA\s+|EC\s+|OPENSSH\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA\s+|EC\s+|OPENSSH\s+)?PRIVATE\s+KEY-----/g
  },
  // AWS access key IDs
  { name: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  // AWS secret access keys (40 char base64)
  { name: 'aws-secret-key', re: /(?<=aws_secret_access_key\s*[=:]\s*)[A-Za-z0-9/+=]{40}/gi },
  // Bearer tokens (20+ chars)
  { name: 'bearer-token', re: /Bearer\s+[A-Za-z0-9_\-.~+/]+=*(?:\s|$)/g },
  // Generic key=value secrets (API keys, passwords, tokens, secrets)
  {
    name: 'key-value-secret',
    re: /(?:api[_-]?key|api[_-]?secret|secret[_-]?key|password|passwd|token|access[_-]?token|client[_-]?secret)\s*[=:]\s*['"]?([^\s'"]{16,})['"]?/gi
  },
  // GitHub personal access tokens
  { name: 'github-pat', re: /\bghp_[A-Za-z0-9]{36,}\b/g },
  // Anthropic API keys
  { name: 'anthropic-key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  // OpenAI API keys (sk-XXXX or sk-proj-XXXX format)
  { name: 'openai-key', re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g },
  // SSH public key content — require mixed case to avoid false positives on uniform strings
  {
    name: 'ssh-key-content',
    re: /\bAAAA(?=[A-Za-z0-9+/]*[a-z])(?=[A-Za-z0-9+/]*[A-Z])(?=[A-Za-z0-9+/]*[0-9])[A-Za-z0-9+/]{100,}={0,2}\b/g
  }
]

/**
 * Sanitize agent response text before sending through a channel.
 * Replaces known secret patterns with [REDACTED].
 *
 * Returns the sanitized text and whether any redactions were made.
 */
export function sanitizeChannelOutput(text: string): { text: string; redacted: boolean } {
  let result = text
  let redacted = false

  for (const { name, re } of SECRET_PATTERNS) {
    // Reset lastIndex for global regexes
    re.lastIndex = 0
    if (re.test(result)) {
      re.lastIndex = 0
      result = result.replace(re, REDACTED)
      redacted = true
      logger.warn('Redacted sensitive content from channel output', { pattern: name })
    }
  }

  return { text: result, redacted }
}
