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

/** Windows drive-letter absolute path, e.g. `C:/Users/…` or `C:\Users\…`. */
export const isWindowsDrivePath = (value: string): boolean => /^[A-Za-z]:[\\/]/.test(value)

/**
 * Parse a markdown link href that targets a workspace file (not a web page) and
 * return the decoded filesystem path to open, or `null` for external links.
 *
 * File vs external is decided by URL scheme (`http`/`https`/`mailto`/… → external;
 * schemeless or `file:` → file), except Windows drive paths (`C:/…`), whose leading
 * `C:` must not be mistaken for a scheme. Query and hash are stripped and
 * percent-encoding decoded, so `./Docs%20Notes.md#section` opens `./Docs Notes.md`.
 *
 * This is the link-boundary counterpart to `isInlineFilePath` (which classifies
 * inline *text*): any non-external target is treated as a file, so single-segment
 * links like `README.md` resolve too.
 */
export function parseFileLinkHref(href: string | undefined): string | null {
  if (!href) return null
  if (href.startsWith('//')) return null // protocol-relative → external
  // Guard Windows drive paths before the generic scheme check: `C:/…` must not
  // parse as scheme `c`.
  const scheme = isWindowsDrivePath(href) ? undefined : /^([a-z][a-z0-9+.-]*):/i.exec(href)?.[1]?.toLowerCase()
  if (scheme && scheme !== 'file') return null // http(s), mailto, tel, … → external
  let path = href.replace(/[?#].*$/, '') // drop query + hash
  if (scheme === 'file') {
    try {
      path = new URL(path).pathname
    } catch {
      return null
    }
  }
  if (!path) return null
  try {
    path = decodeURIComponent(path)
  } catch {
    // keep raw path on malformed percent-encoding
  }
  return path || null
}
