import { loggerService } from '@logger'

const logger = loggerService.withContext('cursor')

/**
 * Split a cursor string on its first `:` separator. Returns `null` only
 * when no separator is present; **empty segments are allowed** so callers
 * with sentinel forms (e.g. `topic:` meaning "pin exhausted") can opt in
 * to permissive parsing.
 *
 * This is the low-level primitive. For standard `<key>:<id>` cursors with
 * both segments required, prefer `decodeCursor` which adds warn-and-fallback
 * on empty segments.
 */
export function splitCursor(raw: string): { key: string; id: string } | null {
  const sep = raw.indexOf(':')
  if (sep < 0) return null
  return { key: raw.slice(0, sep), id: raw.slice(sep + 1) }
}

/**
 * Strict variant of `splitCursor`: requires both segments non-empty and
 * `logger.warn`s on failure. Use for opaque pagination cursors where empty
 * segments indicate a malformed/legacy token.
 *
 * Stale/legacy cursors fall back to `null` instead of throwing — cursors
 * are opaque server-issued tokens, so a 422 here would lock out renderers
 * that hold a pre-upgrade token.
 */
export function decodeCursor(raw: string): { key: string; id: string } | null {
  const split = splitCursor(raw)
  if (!split) {
    logger.warn('decodeCursor: missing separator, falling back to first page', { cursor: raw })
    return null
  }
  if (!split.key || !split.id) {
    logger.warn('decodeCursor: empty key or id, falling back to first page', { cursor: raw })
    return null
  }
  return split
}

export function encodeCursor(key: string, id: string): string {
  return `${key}:${id}`
}
