const INLINE_FILE_PATH_PATTERN = /^(?:\/|\.{1,2}\/)?(?:[^/\s`"'<>|]+\/)+[^/\s`"'<>|]+\.[^/\s`"'<>|.]+$/
const INLINE_FILE_PATH_LOCATION_PATTERN = /(?::\d+){1,2}$/

export const normalizeInlineFilePath = (value: string) =>
  value
    .trim()
    .replace(/^[`("'[]+|[`)"'\],.;:!?]+$/g, '')
    .replace(INLINE_FILE_PATH_LOCATION_PATTERN, '')

export function isInlineFilePath(value: string): boolean {
  return INLINE_FILE_PATH_PATTERN.test(normalizeInlineFilePath(value))
}

export function containsInlineFilePath(value: string | undefined): boolean {
  if (!value) return false

  return value.split(/\s+/).some((token) => isInlineFilePath(token))
}
