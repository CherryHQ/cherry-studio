import type { FileLocation } from '@renderer/types/fileLocation'

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
const INLINE_FILE_PATH_LOCATION_PATTERN = /(?::(\d+)(?::(\d+))?|#L(\d+)(?:-L(\d+))?)$/
const WINDOWS_DRIVE_FILE_PATH_PATTERN = /^[A-Za-z]:[/\\]/

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
 * return the decoded filesystem path and source location, or `null` for external links.
 *
 * The markdown link-safety pipeline (defaultUrlTransform + rehype-sanitize +
 * rehype-harden) only lets protocol-less hrefs through, so a workspace file link is
 * exactly a schemeless target: relative (`./x`, `.agents/x.md`, `README.md`) or
 * an absolute POSIX/Windows path. Explicit URI schemes are treated as external.
 * Source locations are parsed before percent-decoding; other query/hash parts are stripped, so
 * `./Docs%20Notes.md#section` opens `./Docs Notes.md`.
 *
 * This is the link-boundary counterpart to `isInlineFilePath` (which classifies
 * inline *text*): any schemeless target is treated as a file, so single-segment
 * links like `README.md` resolve too.
 */
export function parseFileLinkTarget(href: string | undefined): FileLinkTarget | null {
  if (!href) return null
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
