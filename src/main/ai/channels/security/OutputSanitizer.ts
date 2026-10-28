import { loggerService } from '@logger'
import { SECRET_TOKEN_PATTERNS } from '@shared/utils/redaction'

const logger = loggerService.withContext('OutputSanitizer')

const REDACTED = '[REDACTED]'
const MARKDOWN_CODE_PATTERN = /```[\s\S]*?```|`[^`\n]*`/gm
const CITATION_MARKER_PATTERN = /([ \t]?)\[cite:[\w-]+\]/g

/** Strip internal citation markers from prose while preserving literal examples in code. */
function stripCitationMarkers(text: string): string {
  MARKDOWN_CODE_PATTERN.lastIndex = 0
  let cursor = 0
  let result = ''
  let match: RegExpExecArray | null

  while ((match = MARKDOWN_CODE_PATTERN.exec(text)) !== null) {
    result += text.slice(cursor, match.index).replace(CITATION_MARKER_PATTERN, '')
    result += match[0]
    cursor = match.index + match[0].length
  }

  return result + text.slice(cursor).replace(CITATION_MARKER_PATTERN, '')
}

/**
 * Sanitize agent response text before sending through a channel.
 * Replaces known secret patterns with [REDACTED].
 *
 * Returns the sanitized text and whether any redactions were made.
 */
export function sanitizeChannelOutput(text: string): { text: string; redacted: boolean } {
  let result = stripCitationMarkers(text)
  let redacted = false

  for (const { name, re } of SECRET_TOKEN_PATTERNS) {
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
