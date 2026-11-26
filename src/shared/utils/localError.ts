import { redactSecretText, redactSecretTokens } from './redaction'

/** Local diagnostics are plain text, not provider response payloads. */
export function getSafeLocalErrorMessage(message: unknown): string {
  if (typeof message !== 'string' || message.length > 16_384) return ''
  const text = redactSecretText(redactSecretTokens(message.trim()))
  return text.length > 500 ? `${text.slice(0, 500)}…` : text
}

export function createLocalError(message: string): Error & { errorSource: 'local' } {
  return Object.assign(new Error(getSafeLocalErrorMessage(message)), { errorSource: 'local' as const })
}
