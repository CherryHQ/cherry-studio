/**
 * Runtime operations on the `order_key` column (reads, writes, key generation).
 *
 * This module is the SOLE import site for `fractional-indexing` in the
 * codebase. Every reorder write path and every POST-create endpoint on a
 * sortable table must go through the helpers below. Migrator layer code and
 * one-off migration scripts MUST re-import the generator wrappers from here
 * rather than reaching for `fractional-indexing` directly.
 *
 * Rule: Do NOT import `fractional-indexing` outside this file.
 */

import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type { OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import { and, type AnyColumn, asc, desc, eq, getTableName, gt, inArray, lt, ne, type SQL } from 'drizzle-orm'
import type { AnySQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core'
import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing'

const logger = loggerService.withContext('orderKey')

// Character set is locked to `fractional-indexing`'s default base62
// (0-9A-Za-z). Migrating away from base62 would require a whole-database
// rewrite and must start by passing an explicit `digits` option to the
// generator wrappers below — no call site should assume any other alphabet.

/**
 * Broad transaction/database type. Matches both top-level `DbType` and the
 * transaction callback argument — they share the same query-builder surface
 * for `insert`, `select`, and `update`. Typed as `any` on purpose: the helpers
 * are schema-agnostic and must accept any sortable Drizzle SQLite table, and
 * Drizzle's `LibSQLDatabase<TSchema>` generic parameter would otherwise force
 * call-site casts with no safety benefit.
 */
// biome-ignore lint: intentionally loose — see JSDoc above.
type TxLike = any

/**
 * A sortable Drizzle SQLite table must expose an `orderKey` column. Pk column
 * name varies per table (`appId`, `id`, ...), so helpers accept the column
 * reference rather than assuming a field name.
 */
interface TableWithOrderKey extends SQLiteTable {
  orderKey: AnyColumn
}

interface InsertWithOrderKeyOptions {
  /** Primary-key column of the target table (e.g. `miniappTable.appId`). */
  pkColumn: AnyColumn
  /** Where to insert relative to existing rows. Defaults to `'last'`. */
  position?: 'first' | 'last'
  /** Optional scope predicate narrowing the neighborhood (e.g. `eq(topic.groupId, gid)`). */
  scope?: SQL
}

interface InsertManyWithOrderKeyOptions {
  pkColumn: AnyColumn
  /**
   * Where to insert the whole batch relative to existing rows in scope.
   * Defaults to `'last'`. Within the batch, input order is preserved under
   * `ORDER BY orderKey ASC` — matching the migrator-side
   * `assignOrderKeysInSequence`. For `position: 'last'` the batch lands after
   * the existing rows; for `'first'` it lands before them; relative order
   * inside the batch is always the same as `valuesList`.
   */
  position?: 'first' | 'last'
  scope?: SQL
}

interface ApplyMovesOptions {
  pkColumn: AnyColumn
  scope?: SQL
}

interface ResetOrderOptions {
  pkColumn: AnyColumn
}

interface ComputeOptions {
  pkColumn: AnyColumn
  scope?: SQL
  /**
   * Exclude this pk value from boundary / adjacent lookups. Used internally by
   * `applyMoves` so that "move X to last" becomes a no-op when X is already
   * last in the neighborhood (otherwise the max-key query would return X's
   * own key, forcing a pointless forward bump).
   */
  excludePkValue?: string
}

/**
 * Generate N evenly-spaced order keys starting from an empty space.
 * Returns `[]` for `count === 0`.
 */
export function generateOrderKeySequence(count: number): string[] {
  if (count <= 0) return []
  return generateNKeysBetween(null, null, count)
}

/**
 * Generate a single key strictly between two existing keys (either may be null).
 * Thin wrapper around `fractional-indexing.generateKeyBetween`.
 */
export function generateOrderKeyBetween(before: string | null, after: string | null): string {
  return generateKeyBetween(before, after)
}

/**
 * Generate N sorted keys strictly between two existing keys (either may be null).
 * Returns `[]` for `count === 0`.
 */
export function generateOrderKeySequenceBetween(before: string | null, after: string | null, count: number): string[] {
  if (count <= 0) return []
  return generateNKeysBetween(before, after, count)
}

/**
 * Insert a single row into a sortable table, auto-assigning `orderKey` based
 * on the current first/last key in the scoped neighborhood.
 *
 * Only correct entry point for POST-create endpoints on sortable tables —
 * never write `tx.insert(table).values({ orderKey: ... })` directly. For
 * bulk creation prefer `insertManyWithOrderKey` to avoid N boundary-lookups.
 */
export async function insertWithOrderKey<TTable extends TableWithOrderKey, TValues extends Record<string, unknown>>(
  tx: TxLike,
  table: TTable,
  values: TValues,
  options: InsertWithOrderKeyOptions
): Promise<Record<string, unknown>> {
  const [row] = await insertManyWithOrderKey(tx, table, [values], options)
  if (!row) {
    throw new Error('insertWithOrderKey: insert returned no rows')
  }
  return row
}

/**
 * Insert N rows into a sortable table in a single pass: one boundary-key
 * lookup, one `generateOrderKeySequenceBetween` call, one bulk insert.
 *
 * Use for batch/seed paths where two or more rows are created at once — the
 * single-row `insertWithOrderKey` would repeat the boundary lookup per call.
 * Returns the inserted rows (via `.returning()`) in the same order as
 * `valuesList`. Empty input is a no-op that returns `[]` without touching DB.
 */
export async function insertManyWithOrderKey<TTable extends TableWithOrderKey, TValues extends Record<string, unknown>>(
  tx: TxLike,
  table: TTable,
  valuesList: TValues[],
  options: InsertManyWithOrderKeyOptions
): Promise<Record<string, unknown>[]> {
  if (valuesList.length === 0) return []

  const position = options.position ?? 'last'
  const scope = options.scope

  let keys: string[]
  if (position === 'last') {
    const largest = await selectBoundaryKey(tx, table, 'last', scope)
    keys = generateOrderKeySequenceBetween(largest, null, valuesList.length)
  } else {
    const smallest = await selectBoundaryKey(tx, table, 'first', scope)
    keys = generateOrderKeySequenceBetween(null, smallest, valuesList.length)
  }

  const rowsToInsert = valuesList.map((values, i) => ({ ...values, orderKey: keys[i] }))
  const inserted = await tx.insert(table).values(rowsToInsert).returning()
  return inserted as Record<string, unknown>[]
}

/**
 * Apply a batch of moves sequentially. Each move updates a single row's
 * `orderKey` to satisfy the given anchor.
 *
 * - Duplicate ids are deduped keeping the LAST occurrence; dropped entries
 *   are logged via `loggerService.warn`.
 * - A move whose computed key equals the current key is a no-op (no UPDATE
 *   issued).
 * - Throws if the target id or the anchor id does not exist within the
 *   scoped neighborhood, or if the anchor id equals the move's own id.
 *
 * Known boundary: when the target is already in the anchor's neighbour slot
 * (e.g. anchor `{ before: X }` while the target is already immediately before
 * `X`), the neighbour lookup excludes the target from itself and generates a
 * fresh key, so an equivalent-position UPDATE fires instead of being elided.
 * Correctness is preserved (final ordering is unchanged); only a redundant
 * write is issued. Acceptable at single-user scale; deferred optimisation.
 */
export async function applyMoves(
  tx: TxLike,
  table: TableWithOrderKey,
  moves: Array<{ id: string; anchor: OrderRequest }>,
  options: ApplyMovesOptions
): Promise<void> {
  const { deduped, droppedCount } = dedupMoves(moves)
  if (droppedCount > 0) {
    logger.warn('applyMoves: dropped duplicate move entries, keeping last occurrence', {
      droppedCount,
      totalInput: moves.length
    })
  }

  const pkColumn = options.pkColumn
  const scope = options.scope

  for (const move of deduped) {
    assertAnchorNotSelf(move.id, move.anchor)

    const currentRow = await selectRowByPk(tx, table, pkColumn, move.id, scope)
    if (!currentRow) {
      throw new Error(`applyMoves: move target id "${move.id}" not found in scope`)
    }

    const newKey = await computeNewOrderKey(tx, table, move.anchor, {
      pkColumn,
      scope,
      excludePkValue: move.id
    })

    if (newKey === currentRow.orderKey) {
      continue
    }

    await tx
      .update(table)
      .set({ orderKey: newKey })
      .where(scope ? and(eq(pkColumn, move.id), scope) : eq(pkColumn, move.id))
  }
}

/**
 * Apply a batch of moves that are implicitly scoped by a discriminator column
 * (e.g. `entityType`). The scope value for each target is looked up from the
 * row itself — callers only declare the `scopeColumn`; they do not pre-compute
 * or pass in the scope value.
 *
 * Contract rejections (surfaced as `DataApiError` for direct propagation to
 * the API layer):
 * - Any requested id missing in the table → `NOT_FOUND`. Missing id check runs
 *   before the multi-scope check.
 * - The batch spans more than one distinct scope value → `VALIDATION_ERROR`.
 *   Scoped reorders must not cross scope boundaries; a single request is
 *   expected to stay within one scope bucket.
 *
 * Empty `moves` is a no-op (no DB access).
 */
export async function applyScopedMoves<T extends TableWithOrderKey>(
  tx: TxLike,
  table: T,
  moves: Array<{ id: string; anchor: OrderRequest }>,
  options: { pkColumn: AnySQLiteColumn; scopeColumn: AnySQLiteColumn }
): Promise<void> {
  if (moves.length === 0) return

  const { pkColumn, scopeColumn } = options
  const ids = moves.map((m) => m.id)
  const resourceName = getTableName(table)

  const rows = (await tx
    .select({ id: pkColumn, scope: scopeColumn })
    .from(table)
    .where(inArray(pkColumn, ids))) as Array<{ id: string; scope: unknown }>

  if (rows.length !== ids.length) {
    const foundIds = new Set(rows.map((r) => r.id))
    const missingId = ids.find((id) => !foundIds.has(id)) ?? ids[0]
    throw DataApiErrorFactory.notFound(resourceName, missingId)
  }

  const scopes = new Set(rows.map((r) => r.scope))
  if (scopes.size > 1) {
    // Invariant: batch must share scope — service contract forbids cross-scope moves.
    const scopeList = [...scopes].map((s) => String(s)).join(', ')
    const message = `applyScopedMoves: batch spans multiple scopes (${scopeList})`
    throw DataApiErrorFactory.validation({ _root: [message] }, message)
  }

  const [scopeValue] = [...scopes]
  await applyMoves(tx, table, moves, {
    pkColumn,
    scope: eq(scopeColumn, scopeValue)
  })
}

/**
 * Rewrite `orderKey` for the given rows in the given order, using a fresh
 * evenly-spaced sequence. Paired with `POST /:res/order:reset`.
 *
 * Each row's primary-key value is read via `row[pkColumn.name]`. Missing
 * values throw — a silent `undefined` pk would cause an unscoped UPDATE.
 */
export async function resetOrder<T extends Record<string, unknown>>(
  tx: TxLike,
  table: TableWithOrderKey,
  orderedRows: T[],
  options: ResetOrderOptions
): Promise<void> {
  if (orderedRows.length === 0) return

  const keys = generateOrderKeySequence(orderedRows.length)
  const pkColumn = options.pkColumn

  for (let i = 0; i < orderedRows.length; i++) {
    const row = orderedRows[i] as Record<string, unknown>
    const pkValue = resolvePkValue(row, pkColumn)
    await tx.update(table).set({ orderKey: keys[i] }).where(eq(pkColumn, pkValue))
  }
}

/**
 * Compute the new order key for a single move without writing.
 * Exported for unit tests; `applyMoves` uses it internally.
 */
export async function computeNewOrderKey(
  tx: TxLike,
  table: TableWithOrderKey,
  request: OrderRequest,
  options: ComputeOptions
): Promise<string> {
  const { pkColumn, scope, excludePkValue } = options
  const exclusion = excludePkValue !== undefined ? buildExclusion(pkColumn, excludePkValue, scope) : scope

  if ('position' in request) {
    if (request.position === 'first') {
      const smallest = await selectBoundaryKey(tx, table, 'first', exclusion)
      return generateOrderKeyBetween(null, smallest)
    }
    // 'last'
    const largest = await selectBoundaryKey(tx, table, 'last', exclusion)
    return generateOrderKeyBetween(largest, null)
  }

  if ('before' in request) {
    const anchorId = request.before
    const anchorKey = await requireOrderKey(tx, table, pkColumn, anchorId, scope, 'before')
    const predecessor = await selectAdjacentKey(tx, table, 'predecessor', anchorKey, exclusion)
    return generateOrderKeyBetween(predecessor, anchorKey)
  }

  // 'after'
  const anchorId = request.after
  const anchorKey = await requireOrderKey(tx, table, pkColumn, anchorId, scope, 'after')
  const successor = await selectAdjacentKey(tx, table, 'successor', anchorKey, exclusion)
  return generateOrderKeyBetween(anchorKey, successor)
}

// ---------- internal helpers ----------

/**
 * Deduplicate moves by id, keeping the LAST occurrence.
 */
function dedupMoves(moves: Array<{ id: string; anchor: OrderRequest }>): {
  deduped: Array<{ id: string; anchor: OrderRequest }>
  droppedCount: number
} {
  const byId = new Map<string, { id: string; anchor: OrderRequest }>()
  for (const m of moves) {
    byId.set(m.id, m)
  }
  const droppedCount = moves.length - byId.size
  return { deduped: [...byId.values()], droppedCount }
}

/**
 * Read the primary-key value from a plain row using the Drizzle column's name.
 * Throws if absent — a silent `undefined` pk would cause an unscoped UPDATE.
 */
function resolvePkValue(row: Record<string, unknown>, pkColumn: AnyColumn): string {
  const name = pkColumn.name
  const value = row[name]
  if (value === undefined || value === null || value === '') {
    throw new Error(`resolvePkValue: row is missing primary-key field "${name}"`)
  }
  return String(value)
}

function buildExclusion(pkColumn: AnyColumn, excludePkValue: string, scope?: SQL): SQL {
  const notSelf = ne(pkColumn, excludePkValue)
  return scope ? and(notSelf, scope)! : notSelf
}

function assertAnchorNotSelf(moveId: string, anchor: OrderRequest): void {
  if ('before' in anchor && anchor.before === moveId) {
    throw new Error(`applyMoves: anchor "before" id cannot equal the move's own id ("${moveId}")`)
  }
  if ('after' in anchor && anchor.after === moveId) {
    throw new Error(`applyMoves: anchor "after" id cannot equal the move's own id ("${moveId}")`)
  }
}

/**
 * Select the first (smallest) or last (largest) `orderKey` in scope.
 * Returns `null` when the scope is empty.
 */
async function selectBoundaryKey(
  tx: TxLike,
  table: TableWithOrderKey,
  which: 'first' | 'last',
  scope?: SQL
): Promise<string | null> {
  const orderExpr = which === 'first' ? asc(table.orderKey) : desc(table.orderKey)
  const rows = await tx
    .select({ orderKey: table.orderKey })
    .from(table)
    .where(scope ?? undefined)
    .orderBy(orderExpr)
    .limit(1)
  const first = rows[0] as { orderKey: string | null } | undefined
  return first?.orderKey ?? null
}

/**
 * Find the key immediately adjacent to `anchorKey` in the scoped neighborhood.
 * - `predecessor`: largest key strictly less than anchorKey.
 * - `successor`:   smallest key strictly greater than anchorKey.
 *
 * fractional-indexing keys are ASCII-only, so SQL lexicographic compares
 * match the intended total order.
 */
async function selectAdjacentKey(
  tx: TxLike,
  table: TableWithOrderKey,
  side: 'predecessor' | 'successor',
  anchorKey: string,
  scope?: SQL
): Promise<string | null> {
  const column = table.orderKey
  const predicate = side === 'predecessor' ? lt(column, anchorKey) : gt(column, anchorKey)
  const where = scope ? and(predicate, scope) : predicate
  const orderExpr = side === 'predecessor' ? desc(column) : asc(column)

  const rows = await tx.select({ orderKey: column }).from(table).where(where).orderBy(orderExpr).limit(1)
  const first = rows[0] as { orderKey: string | null } | undefined
  return first?.orderKey ?? null
}

/**
 * Resolve an anchor id to its `orderKey`, constrained to the given scope.
 * Throws if absent.
 */
async function requireOrderKey(
  tx: TxLike,
  table: TableWithOrderKey,
  pkColumn: AnyColumn,
  id: string,
  scope: SQL | undefined,
  anchorKind: 'before' | 'after'
): Promise<string> {
  const row = await selectRowByPk(tx, table, pkColumn, id, scope)
  if (!row) {
    throw new Error(`computeNewOrderKey: anchor id "${id}" for "${anchorKind}" not found in scope`)
  }
  return row.orderKey
}

async function selectRowByPk(
  tx: TxLike,
  table: TableWithOrderKey,
  pkColumn: AnyColumn,
  id: string,
  scope?: SQL
): Promise<{ orderKey: string } | null> {
  const where = scope ? and(eq(pkColumn, id), scope) : eq(pkColumn, id)
  const rows = await tx.select({ orderKey: table.orderKey }).from(table).where(where).limit(1)
  const first = rows[0] as { orderKey: string } | undefined
  return first ?? null
}
