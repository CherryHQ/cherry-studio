const STREAM_PLACEHOLDERS = new Set([
  '',
  'null',
  'undefined',
  '{}',
  '[]',
  '[object object]',
  'unknown stream error',
  'stream error',
  'unknown error'
])

export function isStreamPlaceholderText(text: string): boolean {
  return STREAM_PLACEHOLDERS.has(text.trim().toLowerCase())
}

export function readableStreamText(text: string): string {
  const trimmed = text.trim()
  return isStreamPlaceholderText(trimmed) ? '' : trimmed
}
