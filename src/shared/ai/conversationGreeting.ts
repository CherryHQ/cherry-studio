const MAX_GREETING_LENGTH = 120
const GREETING_CONTROL_PATTERN = /[\p{Cc}\p{Cf}\u2028\u2029]/u
const GREETING_EMOJI_PATTERN = /[\p{Emoji_Presentation}\p{Extended_Pictographic}\u20e3\ufe0f]/u
const GREETING_MARKUP_PATTERN = /[*_`#[\]<>]|^\s*(?:[-+>]|\d+[.)])\s/u
const GREETING_QUOTATION_MARK_PATTERN = /["«»“”„‟「」『』]/u
const GREETING_URL_PATTERN = /(?:https?:\/\/|www\.)/iu
const GREETING_SENTENCE_PATTERN = /[.!?。！？؟।]+/gu

/**
 * Returns a trimmed, display-safe conversation greeting or an empty string.
 * Format controls are rejected so bidi overrides and invisible isolates cannot
 * spoof the rendered heading or cross the renderer-to-main prompt boundary.
 */
export function validateConversationGreeting(text?: string): string {
  const greeting = text?.trim() ?? ''
  if (!greeting || Array.from(greeting).length > MAX_GREETING_LENGTH) return ''
  if (
    GREETING_CONTROL_PATTERN.test(greeting) ||
    GREETING_EMOJI_PATTERN.test(greeting) ||
    GREETING_MARKUP_PATTERN.test(greeting) ||
    GREETING_QUOTATION_MARK_PATTERN.test(greeting) ||
    GREETING_URL_PATTERN.test(greeting)
  ) {
    return ''
  }
  if ((greeting.match(GREETING_SENTENCE_PATTERN) ?? []).length > 2) return ''
  return greeting
}
