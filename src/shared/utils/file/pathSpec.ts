/**
 * Per-platform path SYNTAX — how a path string decomposes, and whether every
 * piece is legal on that platform's filesystem.
 *
 * Lives in shared (no `node:*`), so renderer code can ask these questions too.
 *
 * ## Why platform is a parameter and not an inference
 *
 * The same string is genuinely two different paths. `a/b/c\d.txt` is three
 * segments on POSIX — `c\d.txt` being one filename — and four on Windows.
 * Nothing about the string decides which; only the context it came from does.
 * So the platform is chosen by the caller, never read from `process.platform`
 * (which would make one value validate differently in main, renderer, and the
 * test runner) and never hardcoded (which would impose one platform's syntax on
 * the other's values).
 *
 * ## Layering
 *
 * ```text
 * filename.ts   isValidPosixFileName / isValidWindowsFileName   ← one segment
 * pathSpec.ts   parsePosixPath / parseWindowsPath               ← decomposition
 *               PosixPathSchema / WindowsPathSchema             ← whole path
 * ```
 *
 * This module answers "is this a well-formed path for that platform", NOT "is it
 * relative" or "does it escape its base" — those are structural questions layered
 * on top (see `relativeFilePath.ts`, and eventually the absolute counterpart:
 * `AbsoluteFilePathSchema` currently hand-rolls a union of POSIX / drive / UNC
 * shapes that belongs here).
 *
 * Nothing here is re-exported from the directory barrel: `relativeFilePath.ts` is
 * the only consumer so far, and the syntax layer stays internal until something
 * outside `utils/file` genuinely needs it.
 *
 * ## `.` and `..` are structure, not filenames
 *
 * Both are refused by `isValidWindowsFileName` (it rejects a trailing `.`), yet
 * both are legal navigation segments in a path on either platform. Parsing keeps
 * them in `segments` and validation skips them, leaving `..` handling to the
 * structural layer, which is the only place that knows what the path is relative
 * to.
 */

import { isValidPosixFileName, isValidWindowsFileName } from '@shared/utils/file/filename'
import * as z from 'zod'

/** A path decomposed by one platform's syntax rules. */
export interface ParsedPath {
  /** Whether the path is anchored to a root (`/…`, `C:\…`, `\\server\share\…`, `\…`). */
  isAbsolute: boolean
  /**
   * The root, verbatim and un-normalized (`''` when relative). Retained so a
   * caller can tell `C:\a` from `\\server\share\a` without re-parsing.
   */
  root: string
  /**
   * Segments after the root, in order, with `.`/`..` kept and empty segments
   * (from repeated or trailing separators) dropped. NOT `..`-resolved.
   */
  segments: string[]
}

/**
 * `C:` / `c:` — a Windows drive designator, with or without a following separator.
 *
 * Any single letter counts, so `a:b.txt` parses as drive A's `b.txt` rather than
 * a file named `a:b.txt`. That is Windows' actual reading, and it means a colon
 * only reads as an illegal filename character when it is NOT in drive position
 * (`ab:c.txt`).
 */
const WINDOWS_DRIVE_PATTERN = /^[A-Za-z]:/
/** `\\server\share` — both components required, matching `AbsoluteFilePathSchema`. */
const WINDOWS_UNC_PATTERN = /^\\\\[^\\/]+[\\/][^\\/]+/

const toSegments = (body: string, separator: RegExp): string[] =>
  body.split(separator).filter((segment) => segment !== '')

/**
 * Decompose `value` as a POSIX path: `/` separates, everything else — including
 * `\` and `:` — is an ordinary filename character.
 */
export function parsePosixPath(value: string): ParsedPath {
  const isAbsolute = value.startsWith('/')
  return {
    isAbsolute,
    root: isAbsolute ? '/' : '',
    segments: toSegments(isAbsolute ? value.slice(1) : value, /\//)
  }
}

/**
 * Decompose `value` as a Windows path: `/` and `\` both separate, and a root may
 * be a drive (`C:\`), a UNC share (`\\server\share`), or a bare separator
 * (`\foo`, which is absolute on the current drive).
 *
 * A drive with no separator (`C:foo`) is drive-RELATIVE — a real Windows shape
 * meaning "foo, relative to the working directory on drive C". It reports
 * `isAbsolute: false` with the drive as `root`, so a caller demanding a portable
 * relative path can reject it on the non-empty root rather than mistaking `C:`
 * for a segment.
 */
export function parseWindowsPath(value: string): ParsedPath {
  const uncMatch = WINDOWS_UNC_PATTERN.exec(value)
  if (uncMatch) {
    return { isAbsolute: true, root: uncMatch[0], segments: toSegments(value.slice(uncMatch[0].length), /[/\\]/) }
  }

  const driveMatch = WINDOWS_DRIVE_PATTERN.exec(value)
  if (driveMatch) {
    const rest = value.slice(driveMatch[0].length)
    const rooted = /^[/\\]/.test(rest)
    return {
      isAbsolute: rooted,
      root: rooted ? `${driveMatch[0]}${rest[0]}` : driveMatch[0],
      segments: toSegments(rooted ? rest.slice(1) : rest, /[/\\]/)
    }
  }

  const rooted = /^[/\\]/.test(value)
  return {
    isAbsolute: rooted,
    root: rooted ? value[0] : '',
    segments: toSegments(rooted ? value.slice(1) : value, /[/\\]/)
  }
}

/** `.` and `..` navigate; they are not filenames and are not name-checked. */
const isNavigationSegment = (segment: string) => segment === '.' || segment === '..'

const hasOnlyValidSegments = (parsed: ParsedPath, isValidName: (name: string) => boolean) =>
  parsed.segments.every((segment) => isNavigationSegment(segment) || isValidName(segment))

/** True iff every segment of `value`, read as a POSIX path, could exist on a POSIX filesystem. */
export function isPosixPath(value: string): boolean {
  return !value.includes('\0') && hasOnlyValidSegments(parsePosixPath(value), isValidPosixFileName)
}

/** True iff every segment of `value`, read as a Windows path, could exist on a Windows filesystem. */
export function isWindowsPath(value: string): boolean {
  return !value.includes('\0') && hasOnlyValidSegments(parseWindowsPath(value), isValidWindowsFileName)
}

/**
 * A path whose every segment is legal on a POSIX filesystem. Says nothing about
 * whether it is absolute or relative — that is the structural layer's question.
 *
 * Branded so the two layers compose into one type: intersecting this with a
 * structural brand yields a value that satisfies BOTH, so a `PosixRelativeFilePath`
 * is directly usable wherever a plain `PosixPath` is wanted. Keeping the brand
 * here rather than restating the literal at each composition site also makes this
 * schema the single definition of what `PosixPath` means.
 */
export const PosixPathSchema = z.string().refine(isPosixPath, 'must be a well-formed POSIX path').brand<'PosixPath'>()

export type PosixPath = z.infer<typeof PosixPathSchema>

/** A path whose every segment is legal on a Windows filesystem. See {@link PosixPathSchema}. */
export const WindowsPathSchema = z
  .string()
  .refine(isWindowsPath, 'must be a well-formed Windows path')
  .brand<'WindowsPath'>()

export type WindowsPath = z.infer<typeof WindowsPathSchema>
