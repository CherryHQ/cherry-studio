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
const WINDOWS_DRIVE_FILE_PATH_PATTERN = /^[A-Za-z]:[/\\]/

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

export const resolveInlineFilePath = (value: string, options: { preserveWrappingPunctuation?: boolean } = {}) => {
  const normalizedPath = options.preserveWrappingPunctuation
    ? value.trim().replace(INLINE_FILE_PATH_LOCATION_PATTERN, '')
    : normalizeInlineFilePath(value)
  return expandHomeRelativePath(normalizedPath)
}

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

/**
 * Parse a markdown link href that targets a workspace file (not a web page) and
 * return the decoded filesystem path to open, or `null` for external links.
 *
 * The markdown link-safety pipeline (defaultUrlTransform + rehype-sanitize +
 * rehype-harden) only lets protocol-less hrefs through, so a workspace file link is
 * exactly a schemeless target: relative (`./x`, `.agents/x.md`, `README.md`) or
 * an absolute POSIX/Windows path. Explicit URI schemes are treated as external.
 * Query and hash are stripped and percent-encoding decoded, so
 * `./Docs%20Notes.md#section` opens `./Docs Notes.md`.
 *
 * This is the link-boundary counterpart to `isInlineFilePath` (which classifies
 * inline *text*): any schemeless target is treated as a file, so single-segment
 * links like `README.md` resolve too.
 */
export function parseFileLinkHref(href: string | undefined): string | null {
  if (!href) return null
  const rawPath = href.replace(/[?#].*$/, '') // drop query + hash
  if (!rawPath) return null

  let path: string
  try {
    path = decodeURIComponent(rawPath)
  } catch {
    path = rawPath // keep raw path on malformed percent-encoding
  }

  if (!path || path.startsWith('//')) return null // protocol-relative → external
  if (!WINDOWS_DRIVE_FILE_PATH_PATTERN.test(path) && /^[a-z][a-z0-9+.-]*:/i.test(path)) return null
  return path
}
