import { setupTestDatabase } from '@test-helpers/db'
import { asc, eq } from 'drizzle-orm'
import { sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { beforeAll, describe, expect, it } from 'vitest'

import { ErrorCode } from '@shared/data/api/errors'

import {
  applyMoves,
  applyScopedMoves,
  computeNewOrderKey,
  generateOrderKeyBetween,
  generateOrderKeySequence,
  generateOrderKeySequenceBetween,
  insertManyWithOrderKey,
  insertWithOrderKey,
  resetOrder
} from '../orderKey'

// Test-only fixture tables. Not part of production schema.
const fxTable = sqliteTable('fx_order_key_test', {
  id: text().primaryKey(),
  orderKey: text('order_key').notNull(),
  scope: text()
})

// Second fixture using a non-'id' primary-key column to mirror
// `miniappTable.appId`-style schemas.
const fxAppTable = sqliteTable('fx_order_key_app_test', {
  appKey: text('app_key').primaryKey(),
  orderKey: text('order_key').notNull()
})

/**
 * Run a synchronous `dbh.db.transaction(...)` expected to throw, and return the
 * thrown error for shape assertions. Under better-sqlite3 the transaction
 * callback executes synchronously, so the order-key helpers' contract
 * rejections surface as a synchronous throw rather than a rejected promise.
 * Throws if the function completes without throwing, so a missing rejection
 * still fails the test.
 */
function captureTxThrow(fn: () => unknown): unknown {
  try {
    fn()
  } catch (error) {
    return error
  }
  throw new Error('Expected the transaction to throw, but it completed normally')
}

describe('orderKey', () => {
  const dbh = setupTestDatabase()

  beforeAll(() => {
    // Create test-only tables directly on the shared client. Survive across
    // truncateAll (which only deletes rows, not schema).
    dbh.sqlite.exec(
      'CREATE TABLE IF NOT EXISTS fx_order_key_test (id TEXT PRIMARY KEY, order_key TEXT NOT NULL, scope TEXT)'
    )
    dbh.sqlite.exec(
      'CREATE TABLE IF NOT EXISTS fx_order_key_app_test (app_key TEXT PRIMARY KEY, order_key TEXT NOT NULL)'
    )
  })

  // --- generator wrappers ---

  describe('generateOrderKeySequence', () => {
    it('returns [] for count = 0', () => {
      expect(generateOrderKeySequence(0)).toEqual([])
    })

    it('returns 5 strictly increasing strings', () => {
      const keys = generateOrderKeySequence(5)
      expect(keys).toHaveLength(5)
      for (let i = 1; i < keys.length; i++) {
        expect(keys[i] > keys[i - 1]).toBe(true)
      }
    })
  })

  describe('generateOrderKeyBetween', () => {
    it('returns a single key for (null, null)', () => {
      const key = generateOrderKeyBetween(null, null)
      expect(typeof key).toBe('string')
      expect(key.length).toBeGreaterThan(0)
    })

    it('returns a key strictly between two adjacent keys', () => {
      const a = generateOrderKeyBetween(null, null) // e.g. 'a0'
      const b = generateOrderKeyBetween(a, null) // strictly greater than a
      const mid = generateOrderKeyBetween(a, b)
      expect(mid > a).toBe(true)
      expect(mid < b).toBe(true)
    })
  })

  describe('generateOrderKeySequenceBetween', () => {
    it('returns 3 sorted keys between null and null', () => {
      const keys = generateOrderKeySequenceBetween(null, null, 3)
      expect(keys).toHaveLength(3)
      for (let i = 1; i < keys.length; i++) {
        expect(keys[i] > keys[i - 1]).toBe(true)
      }
    })

    it('returns [] for count = 0', () => {
      expect(generateOrderKeySequenceBetween(null, null, 0)).toEqual([])
    })

    it('keeps repeated mid-insertion between two fixed anchors monotonic and bounded', () => {
      // Force the worst-case pattern: always insert immediately before the
      // right anchor. fractional-indexing must grow string length to keep
      // strict ordering. We verify monotonicity at every step and bound the
      // total growth at O(N) characters (in practice ~N/2 with the default
      // alphabet) so a future bug that double-grows the key per insertion
      // surfaces.
      const N = 100
      const lower = generateOrderKeyBetween(null, null)
      const upper = generateOrderKeyBetween(lower, null)
      let right = upper
      const inserted: string[] = []

      for (let i = 0; i < N; i++) {
        const next = generateOrderKeyBetween(lower, right)
        expect(next > lower).toBe(true)
        expect(next < right).toBe(true)
        inserted.push(next)
        right = next
      }

      // Every insertion must be strictly decreasing (each `next < previous right`).
      for (let i = 1; i < inserted.length; i++) {
        expect(inserted[i] < inserted[i - 1]).toBe(true)
      }
      // Length must grow but not faster than linear with N.
      const maxLen = Math.max(...inserted.map((key) => key.length))
      expect(maxLen).toBeGreaterThan(upper.length)
      expect(maxLen).toBeLessThanOrEqual(upper.length + N)
    })
  })

  // --- insertWithOrderKey ---

  describe('insertWithOrderKey', () => {
    it('inserts into an empty table with a non-empty orderKey', async () => {
      const row = insertWithOrderKey(dbh.db, fxTable, { id: 'a' }, { pkColumn: fxTable.id }) as {
        id: string
        orderKey: string
      }
      expect(row.id).toBe('a')
      expect(row.orderKey).toBeTruthy()
      expect(row.orderKey.length).toBeGreaterThan(0)
    })

    it("appends when position='last' (default)", async () => {
      insertWithOrderKey(dbh.db, fxTable, { id: 'a' }, { pkColumn: fxTable.id })
      insertWithOrderKey(dbh.db, fxTable, { id: 'b' }, { pkColumn: fxTable.id })
      const rows = await dbh.db.select().from(fxTable).orderBy(asc(fxTable.orderKey))
      expect(rows.map((r) => r.id)).toEqual(['a', 'b'])
    })

    it("prepends when position='first'", async () => {
      insertWithOrderKey(dbh.db, fxTable, { id: 'a' }, { pkColumn: fxTable.id })
      insertWithOrderKey(dbh.db, fxTable, { id: 'b' }, { pkColumn: fxTable.id, position: 'first' })
      const rows = await dbh.db.select().from(fxTable).orderBy(asc(fxTable.orderKey))
      expect(rows.map((r) => r.id)).toEqual(['b', 'a'])
    })

    it('with scope: insert into one bucket does not reorder another', async () => {
      insertWithOrderKey(
        dbh.db,
        fxTable,
        { id: 's1a', scope: 's1' },
        { pkColumn: fxTable.id, scope: eq(fxTable.scope, 's1') }
      )
      insertWithOrderKey(
        dbh.db,
        fxTable,
        { id: 's2a', scope: 's2' },
        { pkColumn: fxTable.id, scope: eq(fxTable.scope, 's2') }
      )
      insertWithOrderKey(
        dbh.db,
        fxTable,
        { id: 's1b', scope: 's1' },
        { pkColumn: fxTable.id, scope: eq(fxTable.scope, 's1'), position: 'first' }
      )

      const s1Rows = await dbh.db.select().from(fxTable).where(eq(fxTable.scope, 's1')).orderBy(asc(fxTable.orderKey))
      const s2Rows = await dbh.db.select().from(fxTable).where(eq(fxTable.scope, 's2')).orderBy(asc(fxTable.orderKey))
      expect(s1Rows.map((r) => r.id)).toEqual(['s1b', 's1a'])
      expect(s2Rows.map((r) => r.id)).toEqual(['s2a'])
    })

    it('returns the inserted row shape', async () => {
      const row = insertWithOrderKey(dbh.db, fxTable, { id: 'only' }, { pkColumn: fxTable.id }) as {
        id: string
        orderKey: string
      }
      expect(row).toHaveProperty('id', 'only')
      expect(row).toHaveProperty('orderKey')
      expect(typeof row.orderKey).toBe('string')
    })

    it('supports a non-"id" primary-key column (appKey)', async () => {
      insertWithOrderKey(dbh.db, fxAppTable, { appKey: 'one' }, { pkColumn: fxAppTable.appKey })
      insertWithOrderKey(dbh.db, fxAppTable, { appKey: 'two' }, { pkColumn: fxAppTable.appKey })
      const rows = await dbh.db.select().from(fxAppTable).orderBy(asc(fxAppTable.orderKey))
      expect(rows.map((r) => r.appKey)).toEqual(['one', 'two'])
    })
  })

  // --- applyMoves ---

  describe('applyMoves', () => {
    function seedFx(ids: string[]): void {
      for (const id of ids) {
        insertWithOrderKey(dbh.db, fxTable, { id }, { pkColumn: fxTable.id })
      }
    }

    async function readIds(scope?: string): Promise<string[]> {
      const rows = scope
        ? await dbh.db.select().from(fxTable).where(eq(fxTable.scope, scope)).orderBy(asc(fxTable.orderKey))
        : await dbh.db.select().from(fxTable).orderBy(asc(fxTable.orderKey))
      return rows.map((r) => r.id)
    }

    it('moves a row before another: resulting key < anchor key', async () => {
      seedFx(['a', 'b', 'c'])
      dbh.db.transaction((tx) => {
        applyMoves(tx, fxTable, [{ id: 'c', anchor: { before: 'a' } }], { pkColumn: fxTable.id })
      })
      expect(await readIds()).toEqual(['c', 'a', 'b'])
    })

    it('moves a row after another: resulting key > anchor key', async () => {
      seedFx(['a', 'b', 'c'])
      dbh.db.transaction((tx) => {
        applyMoves(tx, fxTable, [{ id: 'a', anchor: { after: 'c' } }], { pkColumn: fxTable.id })
      })
      expect(await readIds()).toEqual(['b', 'c', 'a'])
    })

    it("position: 'first' moves row to the head", async () => {
      seedFx(['a', 'b', 'c'])
      dbh.db.transaction((tx) => {
        applyMoves(tx, fxTable, [{ id: 'c', anchor: { position: 'first' } }], { pkColumn: fxTable.id })
      })
      expect(await readIds()).toEqual(['c', 'a', 'b'])
    })

    it("position: 'last' moves row to the tail", async () => {
      seedFx(['a', 'b', 'c'])
      dbh.db.transaction((tx) => {
        applyMoves(tx, fxTable, [{ id: 'a', anchor: { position: 'last' } }], { pkColumn: fxTable.id })
      })
      expect(await readIds()).toEqual(['b', 'c', 'a'])
    })

    it('dedups by id keeping the LAST occurrence', async () => {
      seedFx(['a', 'b', 'c'])
      dbh.db.transaction((tx) => {
        applyMoves(
          tx,
          fxTable,
          [
            { id: 'a', anchor: { after: 'b' } },
            { id: 'a', anchor: { position: 'last' } }
          ],
          { pkColumn: fxTable.id }
        )
      })
      // Only the last move ('last') should apply.
      expect(await readIds()).toEqual(['b', 'c', 'a'])
    })

    it('is a no-op when newKey === currentKey', async () => {
      seedFx(['a', 'b', 'c'])
      const before = await dbh.db.select().from(fxTable).orderBy(asc(fxTable.orderKey))
      // Moving 'c' to position 'last' when it is already last ⇒ no change.
      dbh.db.transaction((tx) => {
        applyMoves(tx, fxTable, [{ id: 'c', anchor: { position: 'last' } }], { pkColumn: fxTable.id })
      })
      const after = await dbh.db.select().from(fxTable).orderBy(asc(fxTable.orderKey))
      expect(after).toEqual(before)
    })

    it('throws a NOT_FOUND DataApiError when the target id does not exist', async () => {
      seedFx(['a'])
      expect(
        captureTxThrow(() =>
          dbh.db.transaction((tx) => {
            applyMoves(tx, fxTable, [{ id: 'missing', anchor: { position: 'last' } }], { pkColumn: fxTable.id })
          })
        )
      ).toMatchObject({
        code: ErrorCode.NOT_FOUND,
        message: expect.stringMatching(/missing/),
        details: { resource: 'fx_order_key_test', id: 'missing' }
      })
    })

    it('throws a NOT_FOUND DataApiError when the anchor id does not exist (before)', async () => {
      seedFx(['a'])
      expect(
        captureTxThrow(() =>
          dbh.db.transaction((tx) => {
            applyMoves(tx, fxTable, [{ id: 'a', anchor: { before: 'nope' } }], { pkColumn: fxTable.id })
          })
        )
      ).toMatchObject({
        code: ErrorCode.NOT_FOUND,
        message: expect.stringMatching(/nope/),
        details: { resource: 'fx_order_key_test', id: 'nope' }
      })
    })

    it('throws a NOT_FOUND DataApiError when the anchor id does not exist (after)', async () => {
      seedFx(['a'])
      expect(
        captureTxThrow(() =>
          dbh.db.transaction((tx) => {
            applyMoves(tx, fxTable, [{ id: 'a', anchor: { after: 'nope' } }], { pkColumn: fxTable.id })
          })
        )
      ).toMatchObject({
        code: ErrorCode.NOT_FOUND,
        details: { id: 'nope' }
      })
    })

    it("throws a VALIDATION_ERROR DataApiError when the 'before' anchor equals the move id", async () => {
      seedFx(['a'])
      expect(
        captureTxThrow(() =>
          dbh.db.transaction((tx) => {
            applyMoves(tx, fxTable, [{ id: 'a', anchor: { before: 'a' } }], { pkColumn: fxTable.id })
          })
        )
      ).toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        message: expect.stringMatching(/cannot equal the move's own id/)
      })
    })

    it("throws a VALIDATION_ERROR DataApiError when the 'after' anchor equals the move id", async () => {
      seedFx(['a'])
      expect(
        captureTxThrow(() =>
          dbh.db.transaction((tx) => {
            applyMoves(tx, fxTable, [{ id: 'a', anchor: { after: 'a' } }], { pkColumn: fxTable.id })
          })
        )
      ).toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        message: expect.stringMatching(/cannot equal the move's own id/)
      })
    })

    it('with scope: only touches rows in the scope bucket', async () => {
      insertWithOrderKey(
        dbh.db,
        fxTable,
        { id: 'a', scope: 's1' },
        { pkColumn: fxTable.id, scope: eq(fxTable.scope, 's1') }
      )
      insertWithOrderKey(
        dbh.db,
        fxTable,
        { id: 'b', scope: 's1' },
        { pkColumn: fxTable.id, scope: eq(fxTable.scope, 's1') }
      )
      insertWithOrderKey(
        dbh.db,
        fxTable,
        { id: 'x', scope: 's2' },
        { pkColumn: fxTable.id, scope: eq(fxTable.scope, 's2') }
      )
      insertWithOrderKey(
        dbh.db,
        fxTable,
        { id: 'y', scope: 's2' },
        { pkColumn: fxTable.id, scope: eq(fxTable.scope, 's2') }
      )

      const s2Before = await dbh.db.select().from(fxTable).where(eq(fxTable.scope, 's2')).orderBy(asc(fxTable.orderKey))

      dbh.db.transaction((tx) => {
        applyMoves(tx, fxTable, [{ id: 'b', anchor: { before: 'a' } }], {
          pkColumn: fxTable.id,
          scope: eq(fxTable.scope, 's1')
        })
      })

      expect(await readIds('s1')).toEqual(['b', 'a'])
      const s2After = await dbh.db.select().from(fxTable).where(eq(fxTable.scope, 's2')).orderBy(asc(fxTable.orderKey))
      expect(s2After).toEqual(s2Before)
    })

    it('throws NOT_FOUND DataApiError when anchor id is in a different scope than the target', async () => {
      insertWithOrderKey(
        dbh.db,
        fxTable,
        { id: 'a', scope: 's1' },
        { pkColumn: fxTable.id, scope: eq(fxTable.scope, 's1') }
      )
      insertWithOrderKey(
        dbh.db,
        fxTable,
        { id: 'x', scope: 's2' },
        { pkColumn: fxTable.id, scope: eq(fxTable.scope, 's2') }
      )
      expect(
        captureTxThrow(() =>
          dbh.db.transaction((tx) => {
            applyMoves(tx, fxTable, [{ id: 'a', anchor: { before: 'x' } }], {
              pkColumn: fxTable.id,
              scope: eq(fxTable.scope, 's1')
            })
          })
        )
      ).toMatchObject({
        code: ErrorCode.NOT_FOUND,
        details: { resource: 'fx_order_key_test', id: 'x' }
      })
    })

    it('supports a non-"id" primary-key column', async () => {
      insertWithOrderKey(dbh.db, fxAppTable, { appKey: 'one' }, { pkColumn: fxAppTable.appKey })
      insertWithOrderKey(dbh.db, fxAppTable, { appKey: 'two' }, { pkColumn: fxAppTable.appKey })
      insertWithOrderKey(dbh.db, fxAppTable, { appKey: 'three' }, { pkColumn: fxAppTable.appKey })

      dbh.db.transaction((tx) => {
        applyMoves(tx, fxAppTable, [{ id: 'three', anchor: { position: 'first' } }], {
          pkColumn: fxAppTable.appKey
        })
      })

      const rows = await dbh.db.select().from(fxAppTable).orderBy(asc(fxAppTable.orderKey))
      expect(rows.map((r) => r.appKey)).toEqual(['three', 'one', 'two'])
    })
  })

  // --- resetOrder ---

  describe('resetOrder', () => {
    it('rewrites orderKey in the given order, leaving other columns unchanged', async () => {
      insertWithOrderKey(dbh.db, fxTable, { id: 'a', scope: 'keep-a' }, { pkColumn: fxTable.id })
      insertWithOrderKey(dbh.db, fxTable, { id: 'b', scope: 'keep-b' }, { pkColumn: fxTable.id })
      insertWithOrderKey(dbh.db, fxTable, { id: 'c', scope: 'keep-c' }, { pkColumn: fxTable.id })

      const ordered = [{ id: 'c' }, { id: 'a' }, { id: 'b' }]
      dbh.db.transaction((tx) => {
        resetOrder(tx, fxTable, ordered, { pkColumn: fxTable.id })
      })

      const rows = await dbh.db.select().from(fxTable).orderBy(asc(fxTable.orderKey))
      expect(rows.map((r) => r.id)).toEqual(['c', 'a', 'b'])
      // Non-orderKey columns preserved.
      const byId = new Map(rows.map((r) => [r.id, r.scope]))
      expect(byId.get('a')).toBe('keep-a')
      expect(byId.get('b')).toBe('keep-b')
      expect(byId.get('c')).toBe('keep-c')
    })
  })

  // --- computeNewOrderKey ---

  describe('computeNewOrderKey', () => {
    it('empty scope + position:last → generates a valid starting key', async () => {
      const key = dbh.db.transaction((tx) => {
        return computeNewOrderKey(tx, fxTable, { position: 'last' }, { pkColumn: fxTable.id })
      })
      expect(typeof key).toBe('string')
      expect(key.length).toBeGreaterThan(0)
    })

    it('scope with 1 row, request before anchor → key < anchor.orderKey', async () => {
      insertWithOrderKey(dbh.db, fxTable, { id: 'only' }, { pkColumn: fxTable.id })
      const [onlyRow] = await dbh.db.select().from(fxTable).where(eq(fxTable.id, 'only'))

      const newKey = dbh.db.transaction((tx) => {
        return computeNewOrderKey(tx, fxTable, { before: 'only' }, { pkColumn: fxTable.id })
      })
      expect(newKey < onlyRow.orderKey).toBe(true)
    })
  })

  // --- insertManyWithOrderKey ---

  describe('insertManyWithOrderKey', () => {
    it('returns [] for empty input and does not touch the DB', async () => {
      const result = insertManyWithOrderKey(dbh.db, fxTable, [], { pkColumn: fxTable.id })
      expect(result).toEqual([])
      const rows = await dbh.db.select().from(fxTable)
      expect(rows).toHaveLength(0)
    })

    it("appends N rows when position='last' (default) on an empty table", async () => {
      const inserted = insertManyWithOrderKey(dbh.db, fxTable, [{ id: 'a' }, { id: 'b' }, { id: 'c' }], {
        pkColumn: fxTable.id
      }) as Array<{ id: string; orderKey: string }>

      expect(inserted.map((r) => r.id)).toEqual(['a', 'b', 'c'])
      // Each row has a non-empty orderKey and keys are strictly increasing
      // in the input order (first value → smallest new key at 'last' side).
      for (let i = 1; i < inserted.length; i++) {
        expect(inserted[i].orderKey > inserted[i - 1].orderKey).toBe(true)
      }

      const rows = await dbh.db.select().from(fxTable).orderBy(asc(fxTable.orderKey))
      expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c'])
    })

    it("appends N rows after existing rows when position='last'", async () => {
      insertWithOrderKey(dbh.db, fxTable, { id: 'existing' }, { pkColumn: fxTable.id })
      insertManyWithOrderKey(dbh.db, fxTable, [{ id: 'x' }, { id: 'y' }], { pkColumn: fxTable.id })
      const rows = await dbh.db.select().from(fxTable).orderBy(asc(fxTable.orderKey))
      expect(rows.map((r) => r.id)).toEqual(['existing', 'x', 'y'])
    })

    it("prepends N rows before existing rows when position='first'", async () => {
      insertWithOrderKey(dbh.db, fxTable, { id: 'existing' }, { pkColumn: fxTable.id })
      insertManyWithOrderKey(dbh.db, fxTable, [{ id: 'p' }, { id: 'q' }], {
        pkColumn: fxTable.id,
        position: 'first'
      })
      const rows = await dbh.db.select().from(fxTable).orderBy(asc(fxTable.orderKey))
      // Batch lands before 'existing'; within the batch, input order is
      // preserved under ORDER BY orderKey ASC — [p, q], not [q, p].
      expect(rows.map((r) => r.id)).toEqual(['p', 'q', 'existing'])
    })

    it('performs exactly one boundary lookup regardless of batch size', async () => {
      // Indirect check: if each row did its own boundary lookup the fifth row's
      // key would depend on the fourth — we assert strict monotonic keys in a
      // single invocation, which already holds by the helper's contract.
      const inserted = insertManyWithOrderKey(
        dbh.db,
        fxTable,
        [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }],
        { pkColumn: fxTable.id }
      ) as Array<{ id: string; orderKey: string }>

      const sortedByKey = [...inserted].sort((x, y) => x.orderKey.localeCompare(y.orderKey))
      expect(sortedByKey.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
    })

    it('respects scope: batch insert only sees/affects rows in the target scope', async () => {
      // Seed two scopes with one row each.
      insertWithOrderKey(
        dbh.db,
        fxTable,
        { id: 'a', scope: 'sX' },
        {
          pkColumn: fxTable.id,
          scope: eq(fxTable.scope, 'sX')
        }
      )
      insertWithOrderKey(
        dbh.db,
        fxTable,
        { id: 'b', scope: 'sY' },
        {
          pkColumn: fxTable.id,
          scope: eq(fxTable.scope, 'sY')
        }
      )

      // Batch append into scope sX. sY's key must not be consulted or changed.
      insertManyWithOrderKey(
        dbh.db,
        fxTable,
        [
          { id: 'a2', scope: 'sX' },
          { id: 'a3', scope: 'sX' }
        ],
        { pkColumn: fxTable.id, scope: eq(fxTable.scope, 'sX') }
      )

      const sXRows = await dbh.db.select().from(fxTable).where(eq(fxTable.scope, 'sX')).orderBy(asc(fxTable.orderKey))
      expect(sXRows.map((r) => r.id)).toEqual(['a', 'a2', 'a3'])
      const sYRows = await dbh.db.select().from(fxTable).where(eq(fxTable.scope, 'sY'))
      expect(sYRows.map((r) => r.id)).toEqual(['b'])
    })

    it('supports a non-"id" primary-key column', async () => {
      const inserted = insertManyWithOrderKey(dbh.db, fxAppTable, [{ appKey: 'one' }, { appKey: 'two' }], {
        pkColumn: fxAppTable.appKey
      }) as Array<{ appKey: string; orderKey: string }>

      expect(inserted.map((r) => r.appKey)).toEqual(['one', 'two'])
      expect(inserted[1].orderKey > inserted[0].orderKey).toBe(true)
    })

    // --- legacy invalid boundary keys (#21282) ---

    // Raw-seed rows with orderKey values written verbatim, bypassing the
    // generator — the only way to reproduce rows left by older releases.
    function seedRawKeys(entries: Array<{ id: string; orderKey: string; scope?: string }>): void {
      dbh.db.insert(fxTable).values(entries).run()
    }

    // The library's validateOrderKey is not exported; the generator wrapper is
    // the source of truth for whether a stored key is usable as an anchor.
    function expectValidOrderKey(key: string): void {
      expect(() => generateOrderKeyBetween(key, null)).not.toThrow()
    }

    it("survives a legacy 'zz' tail row: re-keys it to a valid key and appends the batch", async () => {
      seedRawKeys([
        { id: 'keep-a', orderKey: 'a0' },
        { id: 'legacy', orderKey: 'zz' }
      ])

      const inserted = insertManyWithOrderKey(dbh.db, fxTable, [{ id: 'new-1' }, { id: 'new-2' }], {
        pkColumn: fxTable.id
      }) as Array<{ id: string; orderKey: string }>

      const rows = await dbh.db.select().from(fxTable).orderBy(asc(fxTable.orderKey))
      // No row lost, batch appended after the re-keyed row in input order.
      expect(rows.map((r) => r.id)).toEqual(['keep-a', 'legacy', 'new-1', 'new-2'])
      // Every stored key is now generator-valid, and the offender was
      // re-keyed — not deleted, not left as 'zz'.
      for (const row of rows) expectValidOrderKey(row.orderKey)
      expect(rows.find((r) => r.id === 'legacy')!.orderKey).not.toBe('zz')
      // Rows that were already valid are untouched.
      expect(rows.find((r) => r.id === 'keep-a')!.orderKey).toBe('a0')
      expect(inserted.map((r) => r.id)).toEqual(['new-1', 'new-2'])
    })

    it("survives a legacy 'zz' row in an otherwise empty table", async () => {
      seedRawKeys([{ id: 'legacy', orderKey: 'zz' }])

      insertManyWithOrderKey(dbh.db, fxTable, [{ id: 'new-1' }], { pkColumn: fxTable.id })

      const rows = await dbh.db.select().from(fxTable).orderBy(asc(fxTable.orderKey))
      expect(rows.map((r) => r.id)).toEqual(['legacy', 'new-1'])
      for (const row of rows) expectValidOrderKey(row.orderKey)
      expect(rows.find((r) => r.id === 'legacy')!.orderKey).not.toBe('zz')
    })

    it('re-keys every row sharing the invalid tail key', async () => {
      seedRawKeys([
        { id: 'legacy-1', orderKey: 'zz' },
        { id: 'legacy-2', orderKey: 'zz' }
      ])

      insertManyWithOrderKey(dbh.db, fxTable, [{ id: 'new-1' }], { pkColumn: fxTable.id })

      const rows = await dbh.db.select().from(fxTable).orderBy(asc(fxTable.orderKey))
      expect(rows.map((r) => r.id)).toHaveLength(3)
      for (const row of rows) expectValidOrderKey(row.orderKey)
    })

    it("survives an invalid head row when position='first'", async () => {
      seedRawKeys([
        { id: 'legacy', orderKey: '0' },
        { id: 'keep-a', orderKey: 'a1' }
      ])

      insertManyWithOrderKey(dbh.db, fxTable, [{ id: 'new-1' }], { pkColumn: fxTable.id, position: 'first' })

      const rows = await dbh.db.select().from(fxTable).orderBy(asc(fxTable.orderKey))
      expect(rows.map((r) => r.id)).toEqual(['new-1', 'legacy', 'keep-a'])
      for (const row of rows) expectValidOrderKey(row.orderKey)
      expect(rows.find((r) => r.id === 'legacy')!.orderKey).not.toBe('0')
      expect(rows.find((r) => r.id === 'keep-a')!.orderKey).toBe('a1')
    })

    it('re-keys every legacy value still sorting past the repaired tail, keeping the batch last', async () => {
      // 'zy' is invalid and sorts below the 'zz' sentinel but above every
      // generator-valid key: repairing only the boundary value must not leave
      // it (or any other invalid value) after the inserted batch.
      seedRawKeys([
        { id: 'keep-a', orderKey: 'a0' },
        { id: 'legacy-zy', orderKey: 'zy' },
        { id: 'legacy-zz', orderKey: 'zz' }
      ])

      const inserted = insertManyWithOrderKey(dbh.db, fxTable, [{ id: 'new-1' }, { id: 'new-2' }], {
        pkColumn: fxTable.id
      }) as Array<{ id: string; orderKey: string }>

      const rows = await dbh.db.select().from(fxTable).orderBy(asc(fxTable.orderKey))
      expect(rows).toHaveLength(5)
      // The batch is the tail — no pre-existing row sorts after it.
      expect(rows.slice(-2).map((r) => r.id)).toEqual(['new-1', 'new-2'])
      for (const row of rows) expectValidOrderKey(row.orderKey)
      expect(rows.find((r) => r.id === 'legacy-zy')!.orderKey).not.toBe('zy')
      expect(rows.find((r) => r.id === 'legacy-zz')!.orderKey).not.toBe('zz')
      expect(rows.find((r) => r.id === 'keep-a')!.orderKey).toBe('a0')
      expect(inserted.map((r) => r.id)).toEqual(['new-1', 'new-2'])
    })

    it('re-keys every legacy value still sorting before the repaired head, keeping the batch first', async () => {
      // Mirror case for position='first': '2y' sorts below the repaired head
      // yet above every generator-valid key.
      seedRawKeys([
        { id: 'legacy-1x', orderKey: '1x' },
        { id: 'legacy-2y', orderKey: '2y' },
        { id: 'keep-a', orderKey: 'a5' }
      ])

      insertManyWithOrderKey(dbh.db, fxTable, [{ id: 'new-1' }, { id: 'new-2' }], {
        pkColumn: fxTable.id,
        position: 'first'
      })

      const rows = await dbh.db.select().from(fxTable).orderBy(asc(fxTable.orderKey))
      expect(rows).toHaveLength(5)
      // The batch is the head — no pre-existing row sorts before it.
      expect(rows.slice(0, 2).map((r) => r.id)).toEqual(['new-1', 'new-2'])
      for (const row of rows) expectValidOrderKey(row.orderKey)
      expect(rows.find((r) => r.id === 'keep-a')!.orderKey).toBe('a5')
    })

    it('preserves the relative order of multiple repaired tail rows', async () => {
      // z0 < zy < zz are all legacy-invalid and sort above every valid key:
      // re-keying them must keep their original relative order instead of
      // handing the new keys out extremum-first (zz → zy → z0).
      seedRawKeys([
        { id: 'keep-a', orderKey: 'a0' },
        { id: 'legacy-z0', orderKey: 'z0' },
        { id: 'legacy-zy', orderKey: 'zy' },
        { id: 'legacy-zz', orderKey: 'zz' }
      ])

      const inserted = insertManyWithOrderKey(dbh.db, fxTable, [{ id: 'new-1' }, { id: 'new-2' }], {
        pkColumn: fxTable.id
      }) as Array<{ id: string; orderKey: string }>

      const rows = await dbh.db.select().from(fxTable).orderBy(asc(fxTable.orderKey))
      expect(rows).toHaveLength(6)
      // Repaired legacy rows stay in their pre-repair order; the batch is the tail.
      expect(rows.map((r) => r.id)).toEqual(['keep-a', 'legacy-z0', 'legacy-zy', 'legacy-zz', 'new-1', 'new-2'])
      for (const row of rows) expectValidOrderKey(row.orderKey)
      expect(rows.find((r) => r.id === 'keep-a')!.orderKey).toBe('a0')
      expect(inserted.map((r) => r.id)).toEqual(['new-1', 'new-2'])
    })

    it('preserves the relative order of multiple repaired head rows', async () => {
      // Mirror case for position='first': 1x < 2y < 3z are all legacy-invalid
      // and sort below every valid key; their relative order must survive.
      seedRawKeys([
        { id: 'legacy-1x', orderKey: '1x' },
        { id: 'legacy-2y', orderKey: '2y' },
        { id: 'legacy-3z', orderKey: '3z' },
        { id: 'keep-a', orderKey: 'a5' }
      ])

      insertManyWithOrderKey(dbh.db, fxTable, [{ id: 'new-1' }, { id: 'new-2' }], {
        pkColumn: fxTable.id,
        position: 'first'
      })

      const rows = await dbh.db.select().from(fxTable).orderBy(asc(fxTable.orderKey))
      expect(rows).toHaveLength(6)
      // The batch is the head; the repaired legacy rows keep 1x < 2y < 3z.
      expect(rows.map((r) => r.id)).toEqual(['new-1', 'new-2', 'legacy-1x', 'legacy-2y', 'legacy-3z', 'keep-a'])
      for (const row of rows) expectValidOrderKey(row.orderKey)
      expect(rows.find((r) => r.id === 'keep-a')!.orderKey).toBe('a5')
    })

    it('with scope: repairs and appends only within the target scope', async () => {
      seedRawKeys([
        { id: 's1-keep', orderKey: 'a0', scope: 's1' },
        { id: 's1-legacy', orderKey: 'zz', scope: 's1' },
        { id: 's2-keep', orderKey: 'b0', scope: 's2' }
      ])

      insertManyWithOrderKey(dbh.db, fxTable, [{ id: 's1-new', scope: 's1' }], {
        pkColumn: fxTable.id,
        scope: eq(fxTable.scope, 's1')
      })

      const s1Rows = await dbh.db.select().from(fxTable).where(eq(fxTable.scope, 's1')).orderBy(asc(fxTable.orderKey))
      expect(s1Rows.map((r) => r.id)).toEqual(['s1-keep', 's1-legacy', 's1-new'])
      for (const row of s1Rows) expectValidOrderKey(row.orderKey)
      const [s2Row] = await dbh.db.select().from(fxTable).where(eq(fxTable.scope, 's2'))
      expect(s2Row.orderKey).toBe('b0')
    })
  })

  // --- applyScopedMoves ---

  describe('applyScopedMoves', () => {
    function seedScoped(entries: Array<{ id: string; scope: string }>): void {
      for (const { id, scope } of entries) {
        insertWithOrderKey(dbh.db, fxTable, { id, scope }, { pkColumn: fxTable.id, scope: eq(fxTable.scope, scope) })
      }
    }

    async function readIdsInScope(scope: string): Promise<string[]> {
      const rows = await dbh.db.select().from(fxTable).where(eq(fxTable.scope, scope)).orderBy(asc(fxTable.orderKey))
      return rows.map((r) => r.id)
    }

    it('returns without touching the DB when moves is empty', async () => {
      seedScoped([
        { id: 'a', scope: 's1' },
        { id: 'b', scope: 's1' }
      ])
      const before = await dbh.db.select().from(fxTable).orderBy(asc(fxTable.orderKey))

      dbh.db.transaction((tx) => {
        applyScopedMoves(tx, fxTable, [], { pkColumn: fxTable.id, scopeColumn: fxTable.scope })
      })

      const after = await dbh.db.select().from(fxTable).orderBy(asc(fxTable.orderKey))
      expect(after).toEqual(before)
    })

    it('infers scope from the target row and only touches that scope bucket', async () => {
      seedScoped([
        { id: 'a', scope: 's1' },
        { id: 'b', scope: 's1' },
        { id: 'c', scope: 's1' },
        { id: 'x', scope: 's2' },
        { id: 'y', scope: 's2' }
      ])
      const s2Before = await readIdsInScope('s2')
      const s2RowsBefore = await dbh.db.select().from(fxTable).where(eq(fxTable.scope, 's2'))

      dbh.db.transaction((tx) => {
        applyScopedMoves(tx, fxTable, [{ id: 'c', anchor: { before: 'a' } }], {
          pkColumn: fxTable.id,
          scopeColumn: fxTable.scope
        })
      })

      expect(await readIdsInScope('s1')).toEqual(['c', 'a', 'b'])
      expect(await readIdsInScope('s2')).toEqual(s2Before)
      const s2RowsAfter = await dbh.db.select().from(fxTable).where(eq(fxTable.scope, 's2'))
      expect(s2RowsAfter).toEqual(s2RowsBefore)
    })

    it('applies a batch of moves within the same scope', async () => {
      seedScoped([
        { id: 'a', scope: 's1' },
        { id: 'b', scope: 's1' },
        { id: 'c', scope: 's1' },
        { id: 'd', scope: 's1' }
      ])

      dbh.db.transaction((tx) => {
        applyScopedMoves(
          tx,
          fxTable,
          [
            { id: 'd', anchor: { position: 'first' } },
            { id: 'a', anchor: { position: 'last' } }
          ],
          { pkColumn: fxTable.id, scopeColumn: fxTable.scope }
        )
      })

      expect(await readIdsInScope('s1')).toEqual(['d', 'b', 'c', 'a'])
    })

    it('throws a VALIDATION_ERROR DataApiError when batch spans multiple scopes', async () => {
      seedScoped([
        { id: 'a', scope: 's1' },
        { id: 'x', scope: 's2' }
      ])

      const error = captureTxThrow(() =>
        dbh.db.transaction((tx) => {
          applyScopedMoves(
            tx,
            fxTable,
            [
              { id: 'a', anchor: { position: 'last' } },
              { id: 'x', anchor: { position: 'last' } }
            ],
            { pkColumn: fxTable.id, scopeColumn: fxTable.scope }
          )
        })
      )
      expect(error).toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        message: expect.stringMatching(/s1/)
      })
      expect(error).toMatchObject({
        message: expect.stringMatching(/s2/)
      })
    })

    it('throws a NOT_FOUND DataApiError when the target id is not in the table', async () => {
      seedScoped([{ id: 'a', scope: 's1' }])

      expect(
        captureTxThrow(() =>
          dbh.db.transaction((tx) => {
            applyScopedMoves(tx, fxTable, [{ id: 'ghost', anchor: { position: 'last' } }], {
              pkColumn: fxTable.id,
              scopeColumn: fxTable.scope
            })
          })
        )
      ).toMatchObject({
        code: ErrorCode.NOT_FOUND,
        message: expect.stringMatching(/ghost/)
      })
    })

    it('throws NOT_FOUND (not VALIDATION_ERROR) when one id is missing and the rest share scope', async () => {
      seedScoped([
        { id: 'a', scope: 's1' },
        { id: 'b', scope: 's1' }
      ])

      expect(
        captureTxThrow(() =>
          dbh.db.transaction((tx) => {
            applyScopedMoves(
              tx,
              fxTable,
              [
                { id: 'a', anchor: { position: 'last' } },
                { id: 'missing', anchor: { position: 'last' } }
              ],
              { pkColumn: fxTable.id, scopeColumn: fxTable.scope }
            )
          })
        )
      ).toMatchObject({
        code: ErrorCode.NOT_FOUND,
        message: expect.stringMatching(/missing/)
      })
    })
  })
})
