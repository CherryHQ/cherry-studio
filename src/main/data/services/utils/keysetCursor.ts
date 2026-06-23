/**
 * Shared keyset (cursor) pagination codec + ordering builder.
 *
 * List endpoints that page by a `(sortKey, id)` tuple all need the same two
 * things: a `<key>:<id>` wire-format codec, and a keyset WHERE clause paired
 * with its matching ORDER BY (`keysetOrdering`). Both were hand-rolled per
 * service and drifted — the tie-break direction varied, and (worse) the WHERE
 * predicate and the ORDER BY were declared separately and could fall out of
 * sync, silently skipping or repeating rows. This module is the single tested
 * home for them.
 *
 * Scope boundary: this covers single-tuple keyset pagination only. Multi-band
 * / sentinel cursors (e.g. `TopicService`'s pin/topic union with a
 * first-page sentinel) cannot be expressed as one `(key, id)` tuple and must
 * keep their own codec — do NOT route them through here.
 *
 * Two decode policies, deliberately separated:
 * - List browsing (`decodeListCursor`): a malformed cursor warns and falls
 *   back to the first page (returns `null`). A server-issued opaque token
 *   going stale must not throw and lock the renderer.
 * - Search (`ftsSearch.decodeSearchCursor`): a malformed cursor is a client
 *   contract violation and throws 422. That path delegates the parsing here
 *   via `parseCursor` but keeps its own throw policy.
 */

import { loggerService } from '@logger'
import { and, type AnyColumn, asc, desc, eq, gt, lt, or, type SQL } from 'drizzle-orm'

const logger = loggerService.withContext('keysetCursor')

/**
 * Parse a `<key>:<id>` cursor, splitting on the FIRST `:` so ids may contain
 * `:`. Pure and side-effect-free. Returns `null` for any unparseable input:
 * empty/absent `raw`, no separator, empty key, empty id, or a `parseKey` that
 * rejects the key segment.
 *
 * The empty-key guard must run BEFORE `parseKey`: `Number('') === 0` is finite,
 * so `asNumericKey('')` would otherwise resolve a blank key to `0`.
 */
export function parseCursor<K extends string | number>(
  raw: string | undefined,
  parseKey: (s: string) => K | null
): { key: K; id: string } | null {
  if (!raw) return null
  const sep = raw.indexOf(':')
  if (sep < 0) return null
  const keyStr = raw.slice(0, sep)
  const id = raw.slice(sep + 1)
  if (!keyStr || !id) return null
  const key = parseKey(keyStr)
  return key === null ? null : { key, id }
}

/** Encode a `(key, id)` boundary into the `<key>:<id>` wire format. */
export const encodeCursor = (key: string | number, id: string): string => `${key}:${id}`

/**
 * `parseKey` for numeric sort columns (e.g. `createdAt`). Rejects an empty
 * string (`Number('') === 0` is finite, so without this guard a blank key
 * would resolve to `0`) and any non-finite value.
 */
export const asNumericKey = (s: string): number | null => {
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** `parseKey` for string sort columns (e.g. `orderKey`). Rejects empty. */
export const asStringKey = (s: string): string | null => (s === '' ? null : s)

/**
 * List-browsing decode policy: `undefined` raw means "first page" (no warn);
 * a malformed cursor warns once and falls back to the first page (`null`).
 *
 * `context` is a short caller tag (e.g. `'translate-history'`) carried in the
 * warn payload so the source is identifiable while the message stays uniform.
 */
export function decodeListCursor<K extends string | number>(
  raw: string | undefined,
  parseKey: (s: string) => K | null,
  context: string
): { key: K; id: string } | null {
  if (!raw) return null
  const parsed = parseCursor(raw, parseKey)
  if (!parsed) {
    logger.warn('decodeCursor: cursor unparseable, falling back to first page', { cursor: raw, context })
  }
  return parsed
}

/**
 * Build the keyset WHERE predicate AND its matching ORDER BY from a single
 * direction spec, so the two can never drift apart — the classic keyset bug is
 * an ORDER BY that disagrees with the cursor predicate, which silently skips or
 * repeats rows at the page boundary.
 *
 * - `where(cursor)` → `after(keyCol) OR (keyCol = cursor.key AND after(idCol))`,
 *   where `after` is `gt` for `'asc'` and `lt` for `'desc'`.
 * - `orderBy` → `[<major> keyCol, <tie> idCol]`, ready to spread into
 *   `.orderBy(...)`, derived from the SAME `dir`.
 *
 * Returning both from one call is the point: a caller cannot apply the
 * predicate with one direction and the ORDER BY with another.
 */
export function keysetOrdering(
  keyCol: AnyColumn,
  idCol: AnyColumn,
  dir: { major: 'asc' | 'desc'; tie: 'asc' | 'desc' }
): {
  where: (cursor: { key: string | number; id: string }) => SQL
  orderBy: SQL[]
} {
  const after = (col: AnyColumn, d: 'asc' | 'desc', value: string | number) =>
    d === 'asc' ? gt(col, value) : lt(col, value)
  const direction = (d: 'asc' | 'desc') => (d === 'asc' ? asc : desc)
  return {
    where: (cursor) =>
      or(after(keyCol, dir.major, cursor.key), and(eq(keyCol, cursor.key), after(idCol, dir.tie, cursor.id)))!,
    orderBy: [direction(dir.major)(keyCol), direction(dir.tie)(idCol)]
  }
}
