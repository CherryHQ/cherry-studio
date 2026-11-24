import type { FileLocation } from '@renderer/types/fileLocation'

const PATH_SEGMENT_PATTERN = String.raw`[^/\n\r\`"'<>|]+`
const WINDOWS_PATH_SEGMENT_PATTERN = String.raw`[^/\\\n\r\`"'<>|:?]+`
const RELATIVE_SEGMENT_PATTERN = String.raw`[^/\\\n\r\`"'<>|]+`
const ABSOLUTE_FILE_PATH_PATTERN = new RegExp(
  String.raw`^/(?!/)(?:${PATH_SEGMENT_PATTERN}/)+${PATH_SEGMENT_PATTERN}/?$`
)
const WINDOWS_DRIVE_INLINE_PATH_PATTERN = new RegExp(
  String.raw`^[A-Za-z]:[/\\](?:${WINDOWS_PATH_SEGMENT_PATTERN}[/\\])*${WINDOWS_PATH_SEGMENT_PATTERN}[/\\]?$`
)
const RELATIVE_EXPLICIT_PATH_PATTERN = new RegExp(
  String.raw`^\.{1,2}[/\\](?:${RELATIVE_SEGMENT_PATTERN}[/\\])*${RELATIVE_SEGMENT_PATTERN}[/\\]?$`
)
const HOME_RELATIVE_FILE_PATH_PATTERN = new RegExp(
  String.raw`^~[/\\](?:${PATH_SEGMENT_PATTERN}[/\\])*${PATH_SEGMENT_PATTERN}/?$`
)
const WORKSPACE_RELATIVE_FILE_PATH_PATTERN = new RegExp(
  String.raw`^(?:${RELATIVE_SEGMENT_PATTERN}[/\\])+${RELATIVE_SEGMENT_PATTERN}\.[^/\\\`"'<>|.]+$`
)
const INLINE_FILE_PATH_LOCATION_PATTERN = /(?::(\d+)(?::(\d+))?|#L(\d+)(?:-L(\d+))?)$/
const WINDOWS_DRIVE_FILE_PATH_PATTERN = /^[A-Za-z]:[/\\]/
const URI_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i

let inlineFilePathHomePath = ''

export function setInlineFilePathHomePath(homePath: string | undefined): void {
  inlineFilePathHomePath = homePath?.trim().replace(/[\\/]+$/g, '') ?? ''
}

export function expandHomeRelativePath(value: string): string {
  if (!value.startsWith('~/') && !value.startsWith('~\\')) return value
  if (!inlineFilePathHomePath) return value
  return `${inlineFilePathHomePath}${value.slice(1)}`
}

export interface FileLinkTarget {
  path: string
  location?: FileLocation
}

function splitFileLocation(value: string): FileLinkTarget {
  const match = INLINE_FILE_PATH_LOCATION_PATTERN.exec(value)
  if (!match) return { path: value }
  const line = Number(match[1] ?? match[3])
  const column = match[2] ? Number(match[2]) : undefined
  const endLine = match[4] ? Number(match[4]) : undefined
  const valid =
    [line, column, endLine].every((n) => n === undefined || (Number.isSafeInteger(n) && n > 0)) &&
    (endLine === undefined || endLine >= line)
  return {
    path: value.slice(0, match.index),
    ...(valid
      ? {
          location: { line, ...(column === undefined ? {} : { column }), ...(endLine === undefined ? {} : { endLine }) }
        }
      : {})
  }
}

export function parseInlineFileTarget(
  value: string,
  options: { preserveWrappingPunctuation?: boolean } = {}
): FileLinkTarget {
  const normalized = options.preserveWrappingPunctuation
    ? value.trim()
    : value.trim().replace(/^[`("'[]+|[`)"'\],.;:!?]+$/g, '')
  const target = splitFileLocation(normalized)
  return { ...target, path: expandHomeRelativePath(target.path) }
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

export function isInlineFilePath(value: string, platform?: 'posix' | 'windows'): boolean {
  const normalizedPath = normalizeInlineFilePath(value)
  const resolvedPath = resolveInlineFilePath(value)
  const isWorkspaceRelative =
    !URI_SCHEME_PATTERN.test(normalizedPath) && WORKSPACE_RELATIVE_FILE_PATH_PATTERN.test(normalizedPath)
  const isCommonRelative =
    HOME_RELATIVE_FILE_PATH_PATTERN.test(normalizedPath) ||
    RELATIVE_EXPLICIT_PATH_PATTERN.test(normalizedPath) ||
    isWorkspaceRelative

  if (platform === 'windows') {
    return WINDOWS_DRIVE_INLINE_PATH_PATTERN.test(normalizedPath) || isCommonRelative
  }
  if (platform === 'posix') {
    return ABSOLUTE_FILE_PATH_PATTERN.test(resolvedPath) || isCommonRelative
  }
  return (
    ABSOLUTE_FILE_PATH_PATTERN.test(resolvedPath) ||
    WINDOWS_DRIVE_INLINE_PATH_PATTERN.test(normalizedPath) ||
    isCommonRelative
  )
}

/**
 * Parse a markdown link href that targets a workspace file (not a web page) and
 * return the decoded filesystem path and source location, or `null` for external links.
 *
 * The markdown link-safety pipeline (defaultUrlTransform + rehype-sanitize +
 * rehype-harden) lets protocol-less hrefs through and optionally preserves local
 * `file:///` / `file://localhost/` hrefs when `preserveFileLinkHrefs` is enabled.
 * Explicit external URI schemes are treated as external, and remote UNC `file://host/`
 * links are rejected. Source locations are parsed before percent-decoding; other
 * query/hash parts are stripped, so `./Docs%20Notes.md#section` opens `./Docs Notes.md`.
 *
 * This is the link-boundary counterpart to `isInlineFilePath` (which classifies
 * inline *text*): any schemeless target is treated as a file, so single-segment
 * links like `README.md` resolve too.
 */
export function parseFileLinkTarget(href: string | undefined): FileLinkTarget | null {
  if (!href) return null
  if (/^file:\/\//i.test(href)) {
    let url: URL
    try {
      url = new URL(href)
    } catch {
      return null
    }
    if (url.protocol !== 'file:') return null
    const hostname = url.hostname.toLowerCase()
    if (hostname !== '' && hostname !== 'localhost') return null
    const fragment = url.hash.match(/^#L\d+(?:-L\d+)?$/)?.[0]
    const rawPathname = /^\/[A-Za-z]:\//.test(url.pathname) ? url.pathname.slice(1) : url.pathname
    if (!rawPathname || rawPathname === '/') return null
    const rawTarget = splitFileLocation(rawPathname + (fragment ?? ''))
    let decodedPath: string
    try {
      decodedPath = decodeURIComponent(rawTarget.path)
    } catch {
      decodedPath = rawTarget.path
    }
    if (!decodedPath || decodedPath === '/' || decodedPath.startsWith('//')) return null
    return { ...rawTarget, path: expandHomeRelativePath(decodedPath) }
  }
  if (!WINDOWS_DRIVE_FILE_PATH_PATTERN.test(href) && /^[a-z][a-z0-9+.-]*:/i.test(href)) return null
  const fragment = href.match(/#L\d+(?:-L\d+)?$/)?.[0]
  const rawTarget = splitFileLocation(href.replace(/[?#].*$/, '') + (fragment ?? ''))
  const rawPath = rawTarget.path
  if (!rawPath) return null

  let path: string
  try {
    path = decodeURIComponent(rawPath)
  } catch {
    path = rawPath // keep raw path on malformed percent-encoding
  }

  if (!path || path.startsWith('//')) return null // protocol-relative → external
  if (!WINDOWS_DRIVE_FILE_PATH_PATTERN.test(path) && /^[a-z][a-z0-9+.-]*:/i.test(path)) return null
  return { ...rawTarget, path: expandHomeRelativePath(path) }
}

export function parseFileLinkHref(href: string | undefined): string | null {
  return parseFileLinkTarget(href)?.path ?? null
}
