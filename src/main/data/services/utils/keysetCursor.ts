/**
 * Shared keyset (cursor) pagination codecs + ordering builder.
 *
 * List endpoints that page by a `(sortKey, id)` tuple all need the same two
 * things: a `<url-encoded-key>:<id>` wire-format codec, and a keyset WHERE clause paired
 * with its matching ORDER BY (`keysetOrdering`). Both were hand-rolled per
 * service and drifted — the tie-break direction varied, and (worse) the WHERE
 * predicate and the ORDER BY were declared separately and could fall out of
 * sync, silently skipping or repeating rows. This module is the single tested
 * home for them.
 *
 * The legacy `<key>:<id>` codec and direct `where` / `orderBy` fields remain
 * the one-directional contract used by existing endpoints. Bidirectional
 * endpoints use `createKeysetCursorCodec` and `keysetOrdering(...).seek(...)`;
 * their versioned token carries the query family, traversal direction, and
 * exclusive tuple boundary without changing any legacy token.
 *
 * Scope boundary: this covers single-tuple keyset pagination only. Multi-band
 * / sentinel cursors (e.g. `TopicService`'s pin/topic union with a
 * first-page sentinel) cannot be expressed as one `(key, id)` tuple and must
 * keep their own codec — do NOT route them through here.
 *
 * Two decode policies, deliberately separated:
 * - List browsing (`decodeListCursor` and `createKeysetCursorCodec`): a
 *   malformed or incompatible cursor warns and falls back to the first page
 *   (returns `null`). A server-issued opaque token going stale must not throw
 *   and lock the renderer.
 * - Search (`ftsSearch.decodeSearchCursor`): a malformed cursor is a client
 *   contract violation and throws 422. That path delegates the parsing here
 *   via `parseCursor` but keeps its own throw policy.
 */

import { loggerService } from '@logger'
import { and, asc, desc, eq, gt, lt, or, type SQL, type SQLWrapper } from 'drizzle-orm'

const logger = loggerService.withContext('keysetCursor')
const KEYSET_CURSOR_VERSION = 1
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/

export type KeysetPageDirection = 'previous' | 'next'

export interface KeysetBoundary<K extends string | number = string | number> {
  key: K
  id: string
}

export interface DirectionalKeysetCursor<K extends string | number = string | number> extends KeysetBoundary<K> {
  direction: KeysetPageDirection
}

type EncodedDirectionalCursor = readonly [
  version: typeof KEYSET_CURSOR_VERSION,
  family: string,
  direction: KeysetPageDirection,
  key: string,
  id: string
]

type SortDirection = 'asc' | 'desc'
type KeysetDirection = { major: SortDirection; tie: SortDirection }

interface KeysetScan {
  where: (cursor: KeysetBoundary) => SQL
  orderBy: SQL[]
  finish: <T>(rows: readonly T[], limit: number) => { rows: T[]; hasMoreInDirection: boolean }
}

/**
 * Parse a `<url-encoded-key>:<id>` cursor, splitting on the FIRST `:` so ids may contain
 * `:` and user-controlled string keys may contain `:` after decoding. Pure and side-effect-free. Returns `null` for any unparseable input:
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
  let decodedKey: string
  try {
    decodedKey = decodeURIComponent(keyStr)
  } catch {
    return null
  }
  const key = parseKey(decodedKey)
  return key === null ? null : { key, id }
}

/** Encode a `(key, id)` boundary into the `<url-encoded-key>:<id>` wire format. */
export const encodeCursor = (key: string | number, id: string): string => `${encodeURIComponent(String(key))}:${id}`

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
 * Create the opaque, directional codec used by bidirectional list endpoints.
 *
 * The caller owns normalization of `family`: it must identify the endpoint or
 * read model, stream, semantic sort, and every filter/scope dimension that
 * changes membership. It must not include page size, anchor id, UI state, or a
 * resource revision. The codec only stores and compares the supplied identity.
 *
 * Tokens use one strict versioned shape. They are opaque transport tokens, not
 * signatures or authorization; services must still apply their normal filters.
 * Invalid, stale, or wrong-family tokens follow the existing list policy:
 * warn and fall back to the query head (`null`).
 */
export function createKeysetCursorCodec<K extends string | number>({
  family,
  parseKey,
  context
}: {
  family: string
  parseKey: (raw: string) => K | null
  context: string
}): {
  encode: (cursor: DirectionalKeysetCursor<K>) => string
  decode: (raw: string | undefined) => DirectionalKeysetCursor<K> | null
} {
  if (!family) {
    throw new Error('Keyset cursor family must not be empty')
  }

  const warnAndFallback = (reason: string): null => {
    logger.warn('decodeKeysetCursor: cursor invalid or incompatible, falling back to first page', {
      context,
      reason
    })
    return null
  }

  return {
    encode: ({ direction, key, id }) => {
      const payload: EncodedDirectionalCursor = [KEYSET_CURSOR_VERSION, family, direction, String(key), id]
      return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
    },
    decode: (raw) => {
      if (!raw) return null
      if (!BASE64URL_PATTERN.test(raw)) return warnAndFallback('malformed token')

      let payload: unknown
      try {
        payload = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
      } catch {
        return warnAndFallback('malformed token')
      }

      if (!Array.isArray(payload) || payload.length !== 5) {
        return warnAndFallback('malformed payload')
      }

      const [version, tokenFamily, direction, rawKey, id] = payload
      if (version !== KEYSET_CURSOR_VERSION) return warnAndFallback('unsupported version')
      if (typeof tokenFamily !== 'string' || tokenFamily !== family) return warnAndFallback('cursor family mismatch')
      if (direction !== 'previous' && direction !== 'next') return warnAndFallback('invalid direction')
      if (typeof rawKey !== 'string' || typeof id !== 'string' || !rawKey || !id) {
        return warnAndFallback('invalid boundary')
      }

      const key = parseKey(rawKey)
      if (key === null) return warnAndFallback('invalid boundary')

      return { direction, key, id }
    }
  }
}

/**
 * Build the keyset WHERE predicate AND its matching ORDER BY from a single
 * direction spec, so the two can never drift apart — the classic keyset bug is
 * an ORDER BY that disagrees with the cursor predicate, which silently skips or
 * repeats rows at the page boundary.
 *
 * Existing one-direction callers use `where` / `orderBy`, which are aliases
 * for `seek('next')`. Bidirectional callers select a scan with `seek(...)`:
 *
 * - `scan.where(cursor)` is exclusive on the `(key, id)` boundary.
 * - `scan.orderBy` derives both major and tie-break ordering from the same
 *   direction. A previous scan flips both directions.
 * - `scan.finish(rows, limit)` detects the extra row, slices to `limit`, then
 *   restores previous-page rows to canonical query order.
 *
 * Keeping the predicate, SQL ordering, and result restoration in one scan is
 * the point: callers cannot make those three parts disagree.
 */
export function keysetOrdering(
  keyCol: SQLWrapper,
  idCol: SQLWrapper,
  dir: KeysetDirection
): {
  where: (cursor: KeysetBoundary) => SQL
  orderBy: SQL[]
  seek: (direction: KeysetPageDirection) => KeysetScan
} {
  const after = (col: SQLWrapper, d: SortDirection, value: string | number) =>
    d === 'asc' ? gt(col, value) : lt(col, value)
  const order = (d: SortDirection) => (d === 'asc' ? asc : desc)
  const reverse = (d: SortDirection): SortDirection => (d === 'asc' ? 'desc' : 'asc')

  const seek = (pageDirection: KeysetPageDirection): KeysetScan => {
    const scanDirection: KeysetDirection =
      pageDirection === 'next' ? dir : { major: reverse(dir.major), tie: reverse(dir.tie) }

    return {
      where: (cursor) =>
        or(
          after(keyCol, scanDirection.major, cursor.key),
          and(eq(keyCol, cursor.key), after(idCol, scanDirection.tie, cursor.id))
        )!,
      orderBy: [order(scanDirection.major)(keyCol), order(scanDirection.tie)(idCol)],
      finish: (rows, limit) => {
        const hasMoreInDirection = rows.length > limit
        const pageRows = rows.slice(0, limit)
        if (pageDirection === 'previous') pageRows.reverse()
        return { rows: pageRows, hasMoreInDirection }
      }
    }
  }

  const next = seek('next')
  return {
    where: next.where,
    orderBy: next.orderBy,
    seek
  }
}
