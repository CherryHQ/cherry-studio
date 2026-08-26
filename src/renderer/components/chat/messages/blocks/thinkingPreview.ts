const NORMALIZED_WHITESPACE_PATTERN = /\s+/g

export function normalizeThinkingPreview(content: string): string {
  return content.replace(NORMALIZED_WHITESPACE_PATTERN, ' ').trim()
}
