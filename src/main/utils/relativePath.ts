import * as z from 'zod'

/**
 * Safety predicate for a normalized, bounded, **cross-platform-portable
 * relative subpath** — the shape every archive-declared and journal-recorded
 * path must take before it is ever joined onto a trusted root. It is
 * deliberately generic (no backup knowledge) so both the data-layer restore
 * journal and the business-tier backup contracts can depend on it downward.
 *
 * A safe relative subpath:
 * - is a non-empty string within `maxLength`;
 * - uses `/` separators only (a `\\` is treated as hostile, not normalized);
 * - is relative (no leading `/`, no `drive:` prefix);
 * - contains no ASCII control character (0x00–0x1F, 0x7F);
 * - has no empty, `.`, or `..` segment (no current-dir / traversal / `//`);
 * - has at most `maxDepth` segments;
 * - is **Windows-portable**: no segment uses a reserved character
 *   (`< > : " | ? *`), ends in a dot or space, or is a reserved device name
 *   (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`, and Windows'
 *   ISO-8859-1 superscript aliases `COM¹/²/³`, `LPT¹/²/³`, with or without an
 *   extension). A path made on POSIX that violated these would be
 *   unextractable or would silently alias on a Windows target, so a portable
 *   archive must reject them at the producer.
 *
 * It does NOT touch the filesystem: containment against a real root, symlink
 * classification, and same-device eligibility are separate trusted facts the
 * I/O caller supplies. This predicate only judges the string.
 *
 * Case- and Unicode-normalization ALIASING (e.g. `Foo` vs `foo`, NFC vs NFD)
 * is not a per-string property — two individually-valid paths can still collide
 * on a case-insensitive / normalizing filesystem. Detect that at the set level
 * with {@link portableCollisionKey}, not here.
 */
export interface RelativeSubpathLimits {
  readonly maxLength: number
  readonly maxDepth: number
}

/** Built-in defaults; the backup ceilings mirror these so there is one source. */
export const RELATIVE_SUBPATH_LIMITS: RelativeSubpathLimits = Object.freeze({
  maxLength: 1024,
  maxDepth: 64
})

const DRIVE_PREFIX = /^[a-zA-Z]:/
// Windows-reserved characters `< > : " | ? *`. `/` and `\` are handled
// separately (separator / rejected). Control chars are checked by code point
// in `hasControlChar` so this regex stays control-char-free (lint-clean).
const RESERVED_CHARS = /[<>:"|?*]/
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(\.|$)/i

function hasControlChar(segment: string): boolean {
  for (let i = 0; i < segment.length; i++) {
    const code = segment.charCodeAt(i)
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

/** Reject lone UTF-16 surrogates before Node/filesystems replace them with U+FFFD. */
function hasMalformedUtf16(segment: string): boolean {
  for (let i = 0; i < segment.length; i++) {
    const code = segment.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff) {
      if (i + 1 >= segment.length) return true
      const next = segment.charCodeAt(i + 1)
      if (next < 0xdc00 || next > 0xdfff) return true
      i++
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true
    }
  }
  return false
}

function isPortableSegment(segment: string): boolean {
  if (segment === '' || segment === '.' || segment === '..') return false
  if (hasControlChar(segment) || hasMalformedUtf16(segment)) return false
  if (RESERVED_CHARS.test(segment)) return false
  // Windows strips a trailing dot/space, which would silently alias `a ` → `a`.
  if (segment.endsWith('.') || segment.endsWith(' ')) return false
  if (WINDOWS_RESERVED_NAME.test(segment)) return false
  return true
}

export function isSafeRelativeSubpath(
  value: unknown,
  limits: RelativeSubpathLimits = RELATIVE_SUBPATH_LIMITS
): boolean {
  if (typeof value !== 'string' || value.length === 0) return false
  if (value.length > limits.maxLength) return false
  if (value.includes('\\')) return false
  if (value.startsWith('/')) return false
  if (DRIVE_PREFIX.test(value)) return false

  const segments = value.split('/')
  if (segments.length > limits.maxDepth) return false
  for (const segment of segments) {
    if (!isPortableSegment(segment)) return false
  }
  return true
}

/** Split a safe relative subpath into its segments (assumes `isSafeRelativeSubpath`). */
export function toRelativeSegments(value: string): string[] {
  return value.split('/')
}

/**
 * Conservative collision key for detecting two paths that would resolve to the
 * SAME file on a case-insensitive and/or Unicode-normalizing filesystem
 * (macOS/APFS default, Windows/NTFS). NFC-normalizes to unify NFC/NFD forms,
 * then case-folds via locale-independent lowercasing. Used for duplicate and
 * ancestor-overlap detection so `Foo/a` + `foo/a` (or an NFC/NFD pair) are
 * rejected as one target. Never used as the actual install path — only as an
 * equality/prefix key.
 */
export function portableCollisionKey(value: string): string {
  return value.normalize('NFC').toLowerCase()
}

/** Zod schema form of {@link isSafeRelativeSubpath} using the default limits. */
export const RelativeSubpathSchema = z.string().refine((value) => isSafeRelativeSubpath(value), {
  message: 'must be a normalized, bounded, portable relative subpath'
})
