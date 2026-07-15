/**
 * Shared keyset (cursor) pagination codec + ordering builder.
 *
 * List endpoints that page by a `(sortKey, id)` tuple all need the same two
 * things: a `<url-encoded-key>:<id>` wire-format codec, and a keyset WHERE clause paired
 * with its matching ORDER BY (`keysetOrdering`). Both were hand-rolled per
 * service and drifted — the tie-break direction varied, and (worse) the WHERE
 * predicate and the ORDER BY were declared separately and could fall out of
 * sync, silently skipping or repeating rows. This module is the single tested
 * home for them.
 *
 * Scope boundary: this covers single-tuple keyset pagination only. Multiple
 * display bands must use independent query/cursor families (as Topic and
 * AgentSession do), not one sentinel cursor.
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
import { and, asc, desc, eq, gt, lt, or, type SQL, type SQLWrapper } from 'drizzle-orm'

const logger = loggerService.withContext('keysetCursor')

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

// ---------- keyset cursor family binding ----------

/**
 * A keyset cursor binds a `(sortValue, id)` boundary to the exact query family
 * that produced it — resource, pinned/ordinary stream, sort profile, and the
 * normalized membership filters (search term, scope, owner, workspace, bounded
 * ids). The service builds a `family` descriptor per request; a cursor decoded
 * against a different family is treated as "no cursor" (restart from page one),
 * so a stale or foreign token never applies to a different filter, scope, or
 * sort profile.
 */
const CURSOR_FAMILY_VERSION = 1

/**
 * Build a deterministic family descriptor string from `parts`. Keys are sorted
 * so declaration order never changes the fingerprint, and `undefined`
 * normalizes to `null`. Callers must pre-normalize values that have equivalent
 * forms (e.g. sort bounded-id arrays, trim search terms).
 */
export function buildCursorFamily(
  parts: Record<string, string | number | boolean | string[] | null | undefined>
): string {
  const canonical = Object.keys(parts)
    .sort()
    .map((key) => [key, parts[key] ?? null] as const)
  return JSON.stringify(canonical)
}

/** Encode a `(key, id)` boundary plus its query `family` into an opaque, versioned token. */
export function encodeFamilyCursor(family: string, key: string | number, id: string): string {
  const payload = JSON.stringify([CURSOR_FAMILY_VERSION, family, String(key), id])
  return Buffer.from(payload, 'utf8').toString('base64url')
}

/**
 * Decode a family-bound cursor. Returns `null` (first page) for an absent,
 * malformed, wrong-version, or foreign-family token; only a token whose family
 * matches `family` yields a boundary. `context` tags the warn payload.
 */
export function decodeFamilyCursor<K extends string | number>(
  raw: string | undefined,
  family: string,
  parseKey: (s: string) => K | null,
  context: string
): { key: K; id: string } | null {
  if (!raw) return null

  let decoded: unknown
  try {
    decoded = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
  } catch {
    return warnFamilyFallback(raw, context, 'token is not valid base64/JSON')
  }

  if (!Array.isArray(decoded) || decoded.length !== 4) {
    return warnFamilyFallback(raw, context, 'unexpected token shape')
  }
  const [version, tokenFamily, keyStr, id] = decoded as [unknown, unknown, unknown, unknown]
  if (version !== CURSOR_FAMILY_VERSION) return warnFamilyFallback(raw, context, 'version mismatch')
  if (tokenFamily !== family) return warnFamilyFallback(raw, context, 'family mismatch')
  if (typeof keyStr !== 'string' || typeof id !== 'string' || id === '') {
    return warnFamilyFallback(raw, context, 'invalid boundary')
  }
  const key = parseKey(keyStr)
  if (key === null) return warnFamilyFallback(raw, context, 'unparseable sort key')
  return { key, id }
}

function warnFamilyFallback(raw: string, context: string, reason: string): null {
  logger.warn('decodeFamilyCursor: cursor rejected, restarting from the first page', {
    cursor: raw,
    context,
    reason
  })
  return null
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
  keyCol: SQLWrapper,
  idCol: SQLWrapper,
  dir: { major: 'asc' | 'desc'; tie: 'asc' | 'desc' }
): {
  where: (cursor: { key: string | number; id: string }) => SQL
  orderBy: SQL[]
} {
  const after = (col: SQLWrapper, d: 'asc' | 'desc', value: string | number) =>
    d === 'asc' ? gt(col, value) : lt(col, value)
  const direction = (d: 'asc' | 'desc') => (d === 'asc' ? asc : desc)
  return {
    where: (cursor) =>
      or(after(keyCol, dir.major, cursor.key), and(eq(keyCol, cursor.key), after(idCol, dir.tie, cursor.id)))!,
    orderBy: [direction(dir.major)(keyCol), direction(dir.tie)(idCol)]
  }
}
