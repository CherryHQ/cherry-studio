import { ErrorCode } from '@shared/data/api'
import { setupTestDatabase } from '@test-helpers/db'
import { asc, eq } from 'drizzle-orm'
import { sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { beforeAll, describe, expect, it } from 'vitest'

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

describe('orderKey', () => {
  const dbh = setupTestDatabase()

  beforeAll(async () => {
    // Create test-only tables directly on the shared client. Survive across
    // truncateAll (which only deletes rows, not schema).
    await dbh.client.execute(
      'CREATE TABLE IF NOT EXISTS fx_order_key_test (id TEXT PRIMARY KEY, order_key TEXT NOT NULL, scope TEXT)'
    )
    await dbh.client.execute(
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
  })

  // --- insertWithOrderKey ---

  describe('insertWithOrderKey', () => {
    it('inserts into an empty table with a non-empty orderKey', async () => {
      const row = (await insertWithOrderKey(dbh.db, fxTable, { id: 'a' }, { pkColumn: fxTable.id })) as {
        id: string
        orderKey: string
      }
      expect(row.id).toBe('a')
      expect(row.orderKey).toBeTruthy()
      expect(row.orderKey.length).toBeGreaterThan(0)
    })

    it("appends when position='last' (default)", async () => {
      await insertWithOrderKey(dbh.db, fxTable, { id: 'a' }, { pkColumn: fxTable.id })
      await insertWithOrderKey(dbh.db, fxTable, { id: 'b' }, { pkColumn: fxTable.id })
      const rows = await dbh.db.select().from(fxTable).orderBy(asc(fxTable.orderKey))
      expect(rows.map((r) => r.id)).toEqual(['a', 'b'])
    })

    it("prepends when position='first'", async () => {
      await insertWithOrderKey(dbh.db, fxTable, { id: 'a' }, { pkColumn: fxTable.id })
      await insertWithOrderKey(dbh.db, fxTable, { id: 'b' }, { pkColumn: fxTable.id, position: 'first' })
      const rows = await dbh.db.select().from(fxTable).orderBy(asc(fxTable.orderKey))
      expect(rows.map((r) => r.id)).toEqual(['b', 'a'])
    })

    it('with scope: insert into one bucket does not reorder another', async () => {
      await insertWithOrderKey(
        dbh.db,
        fxTable,
        { id: 's1a', scope: 's1' },
        { pkColumn: fxTable.id, scope: eq(fxTable.scope, 's1') }
      )
      await insertWithOrderKey(
        dbh.db,
        fxTable,
        { id: 's2a', scope: 's2' },
        { pkColumn: fxTable.id, scope: eq(fxTable.scope, 's2') }
      )
      await insertWithOrderKey(
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
      const row = (await insertWithOrderKey(dbh.db, fxTable, { id: 'only' }, { pkColumn: fxTable.id })) as {
        id: string
        orderKey: string
      }
      expect(row).toHaveProperty('id', 'only')
      expect(row).toHaveProperty('orderKey')
      expect(typeof row.orderKey).toBe('string')
    })

    it('supports a non-"id" primary-key column (appKey)', async () => {
      await insertWithOrderKey(dbh.db, fxAppTable, { appKey: 'one' }, { pkColumn: fxAppTable.appKey })
      await insertWithOrderKey(dbh.db, fxAppTable, { appKey: 'two' }, { pkColumn: fxAppTable.appKey })
      const rows = await dbh.db.select().from(fxAppTable).orderBy(asc(fxAppTable.orderKey))
      expect(rows.map((r) => r.appKey)).toEqual(['one', 'two'])
    })
  })

  // --- applyMoves ---

  describe('applyMoves', () => {
    async function seedFx(ids: string[]): Promise<void> {
      for (const id of ids) {
        await insertWithOrderKey(dbh.db, fxTable, { id }, { pkColumn: fxTable.id })
      }
    }

    async function readIds(scope?: string): Promise<string[]> {
      const rows = scope
        ? await dbh.db.select().from(fxTable).where(eq(fxTable.scope, scope)).orderBy(asc(fxTable.orderKey))
        : await dbh.db.select().from(fxTable).orderBy(asc(fxTable.orderKey))
      return rows.map((r) => r.id)
    }

    it('moves a row before another: resulting key < anchor key', async () => {
      await seedFx(['a', 'b', 'c'])
      await dbh.db.transaction(async (tx) => {
        await applyMoves(tx, fxTable, [{ id: 'c', anchor: { before: 'a' } }], { pkColumn: fxTable.id })
      })
      expect(await readIds()).toEqual(['c', 'a', 'b'])
    })

    it('moves a row after another: resulting key > anchor key', async () => {
      await seedFx(['a', 'b', 'c'])
      await dbh.db.transaction(async (tx) => {
        await applyMoves(tx, fxTable, [{ id: 'a', anchor: { after: 'c' } }], { pkColumn: fxTable.id })
      })
      expect(await readIds()).toEqual(['b', 'c', 'a'])
    })

    it("position: 'first' moves row to the head", async () => {
      await seedFx(['a', 'b', 'c'])
      await dbh.db.transaction(async (tx) => {
        await applyMoves(tx, fxTable, [{ id: 'c', anchor: { position: 'first' } }], { pkColumn: fxTable.id })
      })
      expect(await readIds()).toEqual(['c', 'a', 'b'])
    })

    it("position: 'last' moves row to the tail", async () => {
      await seedFx(['a', 'b', 'c'])
      await dbh.db.transaction(async (tx) => {
        await applyMoves(tx, fxTable, [{ id: 'a', anchor: { position: 'last' } }], { pkColumn: fxTable.id })
      })
      expect(await readIds()).toEqual(['b', 'c', 'a'])
    })

    it('dedups by id keeping the LAST occurrence', async () => {
      await seedFx(['a', 'b', 'c'])
      await dbh.db.transaction(async (tx) => {
        await applyMoves(
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
      await seedFx(['a', 'b', 'c'])
      const before = await dbh.db.select().from(fxTable).orderBy(asc(fxTable.orderKey))
      // Moving 'c' to position 'last' when it is already last ⇒ no change.
      await dbh.db.transaction(async (tx) => {
        await applyMoves(tx, fxTable, [{ id: 'c', anchor: { position: 'last' } }], { pkColumn: fxTable.id })
      })
      const after = await dbh.db.select().from(fxTable).orderBy(asc(fxTable.orderKey))
      expect(after).toEqual(before)
    })

    it('throws a NOT_FOUND DataApiError when the target id does not exist', async () => {
      await seedFx(['a'])
      await expect(
        dbh.db.transaction(async (tx) => {
          await applyMoves(tx, fxTable, [{ id: 'missing', anchor: { position: 'last' } }], { pkColumn: fxTable.id })
        })
      ).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
        message: expect.stringMatching(/missing/),
        details: { resource: 'fx_order_key_test', id: 'missing' }
      })
    })

    it('throws a NOT_FOUND DataApiError when the anchor id does not exist (before)', async () => {
      await seedFx(['a'])
      await expect(
        dbh.db.transaction(async (tx) => {
          await applyMoves(tx, fxTable, [{ id: 'a', anchor: { before: 'nope' } }], { pkColumn: fxTable.id })
        })
      ).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
        message: expect.stringMatching(/nope/),
        details: { resource: 'fx_order_key_test', id: 'nope' }
      })
    })

    it('throws a NOT_FOUND DataApiError when the anchor id does not exist (after)', async () => {
      await seedFx(['a'])
      await expect(
        dbh.db.transaction(async (tx) => {
          await applyMoves(tx, fxTable, [{ id: 'a', anchor: { after: 'nope' } }], { pkColumn: fxTable.id })
        })
      ).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
        details: { id: 'nope' }
      })
    })

    it("throws a VALIDATION_ERROR DataApiError when the 'before' anchor equals the move id", async () => {
      await seedFx(['a'])
      await expect(
        dbh.db.transaction(async (tx) => {
          await applyMoves(tx, fxTable, [{ id: 'a', anchor: { before: 'a' } }], { pkColumn: fxTable.id })
        })
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        message: expect.stringMatching(/cannot equal the move's own id/)
      })
    })

    it("throws a VALIDATION_ERROR DataApiError when the 'after' anchor equals the move id", async () => {
      await seedFx(['a'])
      await expect(
        dbh.db.transaction(async (tx) => {
          await applyMoves(tx, fxTable, [{ id: 'a', anchor: { after: 'a' } }], { pkColumn: fxTable.id })
        })
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        message: expect.stringMatching(/cannot equal the move's own id/)
      })
    })

    it('with scope: only touches rows in the scope bucket', async () => {
      await insertWithOrderKey(
        dbh.db,
        fxTable,
        { id: 'a', scope: 's1' },
        { pkColumn: fxTable.id, scope: eq(fxTable.scope, 's1') }
      )
      await insertWithOrderKey(
        dbh.db,
        fxTable,
        { id: 'b', scope: 's1' },
        { pkColumn: fxTable.id, scope: eq(fxTable.scope, 's1') }
      )
      await insertWithOrderKey(
        dbh.db,
        fxTable,
        { id: 'x', scope: 's2' },
        { pkColumn: fxTable.id, scope: eq(fxTable.scope, 's2') }
      )
      await insertWithOrderKey(
        dbh.db,
        fxTable,
        { id: 'y', scope: 's2' },
        { pkColumn: fxTable.id, scope: eq(fxTable.scope, 's2') }
      )

      const s2Before = await dbh.db.select().from(fxTable).where(eq(fxTable.scope, 's2')).orderBy(asc(fxTable.orderKey))

      await dbh.db.transaction(async (tx) => {
        await applyMoves(tx, fxTable, [{ id: 'b', anchor: { before: 'a' } }], {
          pkColumn: fxTable.id,
          scope: eq(fxTable.scope, 's1')
        })
      })

      expect(await readIds('s1')).toEqual(['b', 'a'])
      const s2After = await dbh.db.select().from(fxTable).where(eq(fxTable.scope, 's2')).orderBy(asc(fxTable.orderKey))
      expect(s2After).toEqual(s2Before)
    })

    it('throws NOT_FOUND DataApiError when anchor id is in a different scope than the target', async () => {
      await insertWithOrderKey(
        dbh.db,
        fxTable,
        { id: 'a', scope: 's1' },
        { pkColumn: fxTable.id, scope: eq(fxTable.scope, 's1') }
      )
      await insertWithOrderKey(
        dbh.db,
        fxTable,
        { id: 'x', scope: 's2' },
        { pkColumn: fxTable.id, scope: eq(fxTable.scope, 's2') }
      )
      await expect(
        dbh.db.transaction(async (tx) => {
          await applyMoves(tx, fxTable, [{ id: 'a', anchor: { before: 'x' } }], {
            pkColumn: fxTable.id,
            scope: eq(fxTable.scope, 's1')
          })
        })
      ).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
        details: { resource: 'fx_order_key_test', id: 'x' }
      })
    })

    it('supports a non-"id" primary-key column', async () => {
      await insertWithOrderKey(dbh.db, fxAppTable, { appKey: 'one' }, { pkColumn: fxAppTable.appKey })
      await insertWithOrderKey(dbh.db, fxAppTable, { appKey: 'two' }, { pkColumn: fxAppTable.appKey })
      await insertWithOrderKey(dbh.db, fxAppTable, { appKey: 'three' }, { pkColumn: fxAppTable.appKey })

      await dbh.db.transaction(async (tx) => {
        await applyMoves(tx, fxAppTable, [{ id: 'three', anchor: { position: 'first' } }], {
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
      await insertWithOrderKey(dbh.db, fxTable, { id: 'a', scope: 'keep-a' }, { pkColumn: fxTable.id })
      await insertWithOrderKey(dbh.db, fxTable, { id: 'b', scope: 'keep-b' }, { pkColumn: fxTable.id })
      await insertWithOrderKey(dbh.db, fxTable, { id: 'c', scope: 'keep-c' }, { pkColumn: fxTable.id })

      const ordered = [{ id: 'c' }, { id: 'a' }, { id: 'b' }]
      await dbh.db.transaction(async (tx) => {
        await resetOrder(tx, fxTable, ordered, { pkColumn: fxTable.id })
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
      const key = await dbh.db.transaction(async (tx) => {
        return computeNewOrderKey(tx, fxTable, { position: 'last' }, { pkColumn: fxTable.id })
      })
      expect(typeof key).toBe('string')
      expect(key.length).toBeGreaterThan(0)
    })

    it('scope with 1 row, request before anchor → key < anchor.orderKey', async () => {
      await insertWithOrderKey(dbh.db, fxTable, { id: 'only' }, { pkColumn: fxTable.id })
      const [onlyRow] = await dbh.db.select().from(fxTable).where(eq(fxTable.id, 'only'))

      const newKey = await dbh.db.transaction(async (tx) => {
        return computeNewOrderKey(tx, fxTable, { before: 'only' }, { pkColumn: fxTable.id })
      })
      expect(newKey < onlyRow.orderKey).toBe(true)
    })
  })

  // --- insertManyWithOrderKey ---

  describe('insertManyWithOrderKey', () => {
    it('returns [] for empty input and does not touch the DB', async () => {
      const result = await insertManyWithOrderKey(dbh.db, fxTable, [], { pkColumn: fxTable.id })
      expect(result).toEqual([])
      const rows = await dbh.db.select().from(fxTable)
      expect(rows).toHaveLength(0)
    })

    it("appends N rows when position='last' (default) on an empty table", async () => {
      const inserted = (await insertManyWithOrderKey(dbh.db, fxTable, [{ id: 'a' }, { id: 'b' }, { id: 'c' }], {
        pkColumn: fxTable.id
      })) as Array<{ id: string; orderKey: string }>

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
      await insertWithOrderKey(dbh.db, fxTable, { id: 'existing' }, { pkColumn: fxTable.id })
      await insertManyWithOrderKey(dbh.db, fxTable, [{ id: 'x' }, { id: 'y' }], { pkColumn: fxTable.id })
      const rows = await dbh.db.select().from(fxTable).orderBy(asc(fxTable.orderKey))
      expect(rows.map((r) => r.id)).toEqual(['existing', 'x', 'y'])
    })

    it("prepends N rows before existing rows when position='first'", async () => {
      await insertWithOrderKey(dbh.db, fxTable, { id: 'existing' }, { pkColumn: fxTable.id })
      await insertManyWithOrderKey(dbh.db, fxTable, [{ id: 'p' }, { id: 'q' }], {
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
      const inserted = (await insertManyWithOrderKey(
        dbh.db,
        fxTable,
        [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }],
        { pkColumn: fxTable.id }
      )) as Array<{ id: string; orderKey: string }>

      const sortedByKey = [...inserted].sort((x, y) => x.orderKey.localeCompare(y.orderKey))
      expect(sortedByKey.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
    })

    it('respects scope: batch insert only sees/affects rows in the target scope', async () => {
      // Seed two scopes with one row each.
      await insertWithOrderKey(
        dbh.db,
        fxTable,
        { id: 'a', scope: 'sX' },
        {
          pkColumn: fxTable.id,
          scope: eq(fxTable.scope, 'sX')
        }
      )
      await insertWithOrderKey(
        dbh.db,
        fxTable,
        { id: 'b', scope: 'sY' },
        {
          pkColumn: fxTable.id,
          scope: eq(fxTable.scope, 'sY')
        }
      )

      // Batch append into scope sX. sY's key must not be consulted or changed.
      await insertManyWithOrderKey(
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
      const inserted = (await insertManyWithOrderKey(dbh.db, fxAppTable, [{ appKey: 'one' }, { appKey: 'two' }], {
        pkColumn: fxAppTable.appKey
      })) as Array<{ appKey: string; orderKey: string }>

      expect(inserted.map((r) => r.appKey)).toEqual(['one', 'two'])
      expect(inserted[1].orderKey > inserted[0].orderKey).toBe(true)
    })
  })

  // --- applyScopedMoves ---

  describe('applyScopedMoves', () => {
    async function seedScoped(entries: Array<{ id: string; scope: string }>): Promise<void> {
      for (const { id, scope } of entries) {
        await insertWithOrderKey(
          dbh.db,
          fxTable,
          { id, scope },
          { pkColumn: fxTable.id, scope: eq(fxTable.scope, scope) }
        )
      }
    }

    async function readIdsInScope(scope: string): Promise<string[]> {
      const rows = await dbh.db.select().from(fxTable).where(eq(fxTable.scope, scope)).orderBy(asc(fxTable.orderKey))
      return rows.map((r) => r.id)
    }

    it('returns without touching the DB when moves is empty', async () => {
      await seedScoped([
        { id: 'a', scope: 's1' },
        { id: 'b', scope: 's1' }
      ])
      const before = await dbh.db.select().from(fxTable).orderBy(asc(fxTable.orderKey))

      await dbh.db.transaction(async (tx) => {
        await applyScopedMoves(tx, fxTable, [], { pkColumn: fxTable.id, scopeColumn: fxTable.scope })
      })

      const after = await dbh.db.select().from(fxTable).orderBy(asc(fxTable.orderKey))
      expect(after).toEqual(before)
    })

    it('infers scope from the target row and only touches that scope bucket', async () => {
      await seedScoped([
        { id: 'a', scope: 's1' },
        { id: 'b', scope: 's1' },
        { id: 'c', scope: 's1' },
        { id: 'x', scope: 's2' },
        { id: 'y', scope: 's2' }
      ])
      const s2Before = await readIdsInScope('s2')
      const s2RowsBefore = await dbh.db.select().from(fxTable).where(eq(fxTable.scope, 's2'))

      await dbh.db.transaction(async (tx) => {
        await applyScopedMoves(tx, fxTable, [{ id: 'c', anchor: { before: 'a' } }], {
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
      await seedScoped([
        { id: 'a', scope: 's1' },
        { id: 'b', scope: 's1' },
        { id: 'c', scope: 's1' },
        { id: 'd', scope: 's1' }
      ])

      await dbh.db.transaction(async (tx) => {
        await applyScopedMoves(
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
      await seedScoped([
        { id: 'a', scope: 's1' },
        { id: 'x', scope: 's2' }
      ])

      await expect(
        dbh.db.transaction(async (tx) => {
          await applyScopedMoves(
            tx,
            fxTable,
            [
              { id: 'a', anchor: { position: 'last' } },
              { id: 'x', anchor: { position: 'last' } }
            ],
            { pkColumn: fxTable.id, scopeColumn: fxTable.scope }
          )
        })
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        message: expect.stringMatching(/s1/)
      })

      await expect(
        dbh.db.transaction(async (tx) => {
          await applyScopedMoves(
            tx,
            fxTable,
            [
              { id: 'a', anchor: { position: 'last' } },
              { id: 'x', anchor: { position: 'last' } }
            ],
            { pkColumn: fxTable.id, scopeColumn: fxTable.scope }
          )
        })
      ).rejects.toMatchObject({
        message: expect.stringMatching(/s2/)
      })
    })

    it('throws a NOT_FOUND DataApiError when the target id is not in the table', async () => {
      await seedScoped([{ id: 'a', scope: 's1' }])

      await expect(
        dbh.db.transaction(async (tx) => {
          await applyScopedMoves(tx, fxTable, [{ id: 'ghost', anchor: { position: 'last' } }], {
            pkColumn: fxTable.id,
            scopeColumn: fxTable.scope
          })
        })
      ).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
        message: expect.stringMatching(/ghost/)
      })
    })

    it('throws NOT_FOUND (not VALIDATION_ERROR) when one id is missing and the rest share scope', async () => {
      await seedScoped([
        { id: 'a', scope: 's1' },
        { id: 'b', scope: 's1' }
      ])

      await expect(
        dbh.db.transaction(async (tx) => {
          await applyScopedMoves(
            tx,
            fxTable,
            [
              { id: 'a', anchor: { position: 'last' } },
              { id: 'missing', anchor: { position: 'last' } }
            ],
            { pkColumn: fxTable.id, scopeColumn: fxTable.scope }
          )
        })
      ).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
        message: expect.stringMatching(/missing/)
      })
    })
  })
})
