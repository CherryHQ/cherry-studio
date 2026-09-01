/** Normalize model-authored text before placing it inside a trusted prompt boundary. */
export function sanitizeUntrustedText(text: string): string {
  return stripInvisibleCharacters(text.replace(/\uFF1C|\u3008/g, '<').replace(/\uFF1E|\u3009/g, '>'))
}

export function stripInvisibleCharacters(text: string): string {
  return text.replace(
    // oxlint-disable-next-line no-misleading-character-class -- intentional invisible character detection
    /[\u200B\u200C\u200D\u200E\u200F\uFEFF\u00AD\u2060\u2061\u2062\u2063\u2064\u2066\u2067\u2068\u2069\u206A-\u206F]/g,
    ''
  )
}

export function defangSystemReminderTags(text: string): string {
  return text.replace(/<(\/?\s*system-reminder\b[^>]*)>/gi, '&lt;$1>')
}
