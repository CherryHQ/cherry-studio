const FIRST_USER_MESSAGE_TITLE_MAX_LENGTH = 50

export function sanitizeConversationTitle(title: string): string {
  return title.replace(/["'\r\n]+/g, ' ').trim()
}

export function truncateFirstUserMessageTitleSource(text: string): string {
  const normalized = text.trim().replace(/\s+/g, ' ')
  if (normalized.length <= FIRST_USER_MESSAGE_TITLE_MAX_LENGTH) return normalized
  return normalized.slice(0, FIRST_USER_MESSAGE_TITLE_MAX_LENGTH).trim()
}

export function buildFirstUserMessageTitle(userText: string): string {
  return sanitizeConversationTitle(truncateFirstUserMessageTitleSource(userText))
}

export function normalizeConversationTitle(title: string | null | undefined): string {
  return (title ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}
