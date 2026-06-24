const PATH_SEGMENT_PATTERN = String.raw`[^/\n\r\`"'<>|]+`
const ABSOLUTE_FILE_PATH_PATTERN = new RegExp(
  String.raw`^/(?!/)(?:${PATH_SEGMENT_PATTERN}/)+${PATH_SEGMENT_PATTERN}/?$`
)
const RELATIVE_EXPLICIT_PATH_PATTERN = new RegExp(
  String.raw`^\.{1,2}/(?:${PATH_SEGMENT_PATTERN}/)*${PATH_SEGMENT_PATTERN}/?$`
)
const HOME_RELATIVE_FILE_PATH_PATTERN = new RegExp(
  String.raw`^~[/\\](?:${PATH_SEGMENT_PATTERN}[/\\])*${PATH_SEGMENT_PATTERN}/?$`
)
const WORKSPACE_RELATIVE_FILE_PATH_PATTERN = new RegExp(
  String.raw`^(?:${PATH_SEGMENT_PATTERN}/)+${PATH_SEGMENT_PATTERN}\.[^/\`"'<>|.]+$`
)
const INLINE_FILE_PATH_LOCATION_PATTERN = /(?::\d+){1,2}$/

let inlineFilePathHomePath = ''

export function setInlineFilePathHomePath(homePath: string | undefined): void {
  inlineFilePathHomePath = homePath?.trim().replace(/[\\/]+$/g, '') ?? ''
}

function expandHomeRelativePath(value: string): string {
  if (!value.startsWith('~/') && !value.startsWith('~\\')) return value
  if (!inlineFilePathHomePath) return value
  return `${inlineFilePathHomePath}${value.slice(1)}`
}

export const normalizeInlineFilePath = (value: string) =>
  value
    .trim()
    .replace(/^[`("'[]+|[`)"'\],.;:!?]+$/g, '')
    .replace(INLINE_FILE_PATH_LOCATION_PATTERN, '')

export const resolveInlineFilePath = (value: string) => expandHomeRelativePath(normalizeInlineFilePath(value))

export function isInlineFilePath(value: string): boolean {
  const normalizedPath = normalizeInlineFilePath(value)
  const resolvedPath = resolveInlineFilePath(value)
  return (
    ABSOLUTE_FILE_PATH_PATTERN.test(resolvedPath) ||
    HOME_RELATIVE_FILE_PATH_PATTERN.test(normalizedPath) ||
    RELATIVE_EXPLICIT_PATH_PATTERN.test(normalizedPath) ||
    WORKSPACE_RELATIVE_FILE_PATH_PATTERN.test(normalizedPath)
  )
}

export function containsInlineFilePath(value: string | undefined): boolean {
  if (!value) return false

  return value.split(/\s+/).some((token) => isInlineFilePath(token))
}
