import { loggerService } from '@logger'
import { stripCitationMarkers } from '@main/ai/utils/citationIds'
import { SECRET_TOKEN_PATTERNS } from '@shared/utils/redaction'

const logger = loggerService.withContext('OutputSanitizer')

const REDACTED = '[REDACTED]'

/**
 * Sanitize agent response text before sending through a channel.
 * Replaces known secret patterns with [REDACTED].
 *
 * Returns the sanitized text and whether any redactions were made.
 */
export function sanitizeChannelOutput(text: string): { text: string; redacted: boolean } {
  const result = sanitizeChannelOutputSilently(text)
  for (const pattern of result.redactedPatterns) {
    logger.warn('Redacted sensitive content from channel output', { pattern })
  }
  return { text: result.text, redacted: result.redactedPatterns.length > 0 }
}

/** Same sanitization as {@link sanitizeChannelOutput}, without logging, for repeated live-preview passes. */
export function sanitizeChannelOutputSilently(text: string): { text: string; redactedPatterns: string[] } {
  let result = stripCitationMarkers(text)
  const redactedPatterns: string[] = []

  for (const { name, re } of SECRET_TOKEN_PATTERNS) {
    // Reset lastIndex for global regexes
    re.lastIndex = 0
    if (re.test(result)) {
      re.lastIndex = 0
      result = result.replace(re, REDACTED)
      redactedPatterns.push(name)
    }
  }

  return { text: result, redactedPatterns }
}
