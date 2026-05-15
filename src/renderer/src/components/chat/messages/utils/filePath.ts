const INLINE_ABSOLUTE_FILE_PATH_PATTERN = /^\/[\w.-]+(?:\/[\w.-]+)+$/

const trimInlinePathToken = (value: string) => value.replace(/^[`("'\[]+|[`)"'\],.;:!?]+$/g, '')

export function isInlineAbsoluteFilePath(value: string): boolean {
  return INLINE_ABSOLUTE_FILE_PATH_PATTERN.test(value)
}

export function containsInlineAbsoluteFilePath(value: string | undefined): boolean {
  if (!value) return false

  return value.split(/\s+/).some((token) => isInlineAbsoluteFilePath(trimInlinePathToken(token)))
}
