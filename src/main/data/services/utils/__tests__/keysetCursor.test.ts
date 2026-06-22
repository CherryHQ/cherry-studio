import { setupTestDatabase } from '@test-helpers/db'
import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { asNumericKey, asStringKey, decodeListCursor, encodeCursor, keysetOrdering, parseCursor } from '../keysetCursor'

describe('keysetCursor codec', () => {
  describe('parseCursor', () => {
    it('returns null for an absent or empty raw cursor', () => {
      expect(parseCursor(undefined, asStringKey)).toBeNull()
      expect(parseCursor('', asStringKey)).toBeNull()
    })

    it('returns null when no separator is present', () => {
      expect(parseCursor('no-colon', asStringKey)).toBeNull()
    })

    it('returns null for an empty key — guarded before parseKey so a blank key is not coerced to 0', () => {
      expect(parseCursor(':item-1', asNumericKey)).toBeNull()
      expect(parseCursor(':item-1', asStringKey)).toBeNull()
    })

    it('returns null for an empty id', () => {
      expect(parseCursor('A0:', asStringKey)).toBeNull()
    })

    it('returns null when parseKey rejects the key segment', () => {
      expect(parseCursor('abc:item-1', asNumericKey)).toBeNull()
    })

    it('parses a numeric key', () => {
      expect(parseCursor('100:item-1', asNumericKey)).toEqual({ key: 100, id: 'item-1' })
    })

    it('parses a string key', () => {
      expect(parseCursor('A0:painting-1', asStringKey)).toEqual({ key: 'A0', id: 'painting-1' })
    })

    it('splits on the first colon so ids may themselves contain colons', () => {
      expect(parseCursor('1:2:3', asNumericKey)).toEqual({ key: 1, id: '2:3' })
    })
  })

  describe('encodeCursor', () => {
    it('joins key and id with a colon for both number and string keys', () => {
      expect(encodeCursor(100, 'item-1')).toBe('100:item-1')
      expect(encodeCursor('A0', 'painting-1')).toBe('A0:painting-1')
    })

    it('round-trips through parseCursor', () => {
      expect(parseCursor(encodeCursor(100, 'item-1'), asNumericKey)).toEqual({ key: 100, id: 'item-1' })
      expect(parseCursor(encodeCursor('A0', 'painting-1'), asStringKey)).toEqual({ key: 'A0', id: 'painting-1' })
    })
  })

  describe('asNumericKey / asStringKey', () => {
    it('asNumericKey rejects an empty string instead of coercing it to 0', () => {
      expect(asNumericKey('')).toBeNull()
    })

    it('asNumericKey rejects non-numeric input', () => {
      expect(asNumericKey('abc')).toBeNull()
    })

    it('asNumericKey accepts 0 and other finite numbers', () => {
      expect(asNumericKey('0')).toBe(0)
      expect(asNumericKey('100')).toBe(100)
    })

    it('asStringKey rejects an empty string but passes other values through', () => {
      expect(asStringKey('')).toBeNull()
      expect(asStringKey('A0')).toBe('A0')
    })
  })

  describe('decodeListCursor', () => {
    beforeEach(() => {
      mockMainLoggerService.warn.mockClear()
    })

    it('returns null without warning for an absent cursor (first page)', () => {
      expect(decodeListCursor(undefined, asNumericKey, 'translate-history')).toBeNull()
      expect(mockMainLoggerService.warn).not.toHaveBeenCalled()
    })

    it('parses a valid cursor without warning', () => {
      expect(decodeListCursor('100:item-1', asNumericKey, 'translate-history')).toEqual({ key: 100, id: 'item-1' })
      expect(mockMainLoggerService.warn).not.toHaveBeenCalled()
    })

    it('warns exactly once with the locked message and falls back to the first page on a malformed cursor', () => {
      expect(decodeListCursor('garbage', asNumericKey, 'translate-history')).toBeNull()
      expect(mockMainLoggerService.warn).toHaveBeenCalledTimes(1)
      expect(mockMainLoggerService.warn).toHaveBeenCalledWith(
        'decodeCursor: cursor unparseable, falling back to first page',
        { cursor: 'garbage', context: 'translate-history' }
      )
    })
  })
})

// Test-only fixture table. Not part of production schema. `b` and `c` collide
// on BOTH num_key (100) and str_key ('A1'), so the tie-break direction is
// exercised by every shape below.
const fxTable = sqliteTable('fx_keyset_cursor_test', {
  id: text().primaryKey(),
  numKey: integer('num_key').notNull(),
  strKey: text('str_key').notNull()
})

const FIXTURE_ROWS = [
  { id: 'a', numKey: 200, strKey: 'A0' },
  { id: 'b', numKey: 100, strKey: 'A1' },
  { id: 'c', numKey: 100, strKey: 'A1' },
  { id: 'd', numKey: 50, strKey: 'A2' }
]

describe('keysetOrdering — direction coverage against real SQLite', () => {
  const dbh = setupTestDatabase()

  beforeAll(async () => {
    await dbh.client.execute(
      'CREATE TABLE IF NOT EXISTS fx_keyset_cursor_test (id TEXT PRIMARY KEY, num_key INTEGER NOT NULL, str_key TEXT NOT NULL)'
    )
  })

  beforeEach(async () => {
    // setupTestDatabase's beforeEach truncates user tables; re-seed here.
    // Delete-first keeps this safe regardless of whether truncateAll covers
    // test-only fixture tables.
    await dbh.db.delete(fxTable)
    await dbh.db.insert(fxTable).values(FIXTURE_ROWS)
  })

  it('TranslateHistory shape — num_key DESC, id ASC ({ major: desc, tie: asc })', async () => {
    const ordering = keysetOrdering(fxTable.numKey, fxTable.id, { major: 'desc', tie: 'asc' })
    const rows = await dbh.db
      .select({ id: fxTable.id })
      .from(fxTable)
      .where(ordering.where({ key: 100, id: 'b' }))
      .orderBy(...ordering.orderBy)
    expect(rows.map((r) => r.id)).toEqual(['c', 'd'])
  })

  it('AgentSessionMessage LIST shape — num_key DESC, id DESC ({ major: desc, tie: desc })', async () => {
    const ordering = keysetOrdering(fxTable.numKey, fxTable.id, { major: 'desc', tie: 'desc' })
    const rows = await dbh.db
      .select({ id: fxTable.id })
      .from(fxTable)
      .where(ordering.where({ key: 100, id: 'c' }))
      .orderBy(...ordering.orderBy)
    expect(rows.map((r) => r.id)).toEqual(['b', 'd'])
  })

  it('AgentSession / Painting shape — str_key ASC, id ASC ({ major: asc, tie: asc })', async () => {
    const ordering = keysetOrdering(fxTable.strKey, fxTable.id, { major: 'asc', tie: 'asc' })
    const rows = await dbh.db
      .select({ id: fxTable.id })
      .from(fxTable)
      .where(ordering.where({ key: 'A1', id: 'b' }))
      .orderBy(...ordering.orderBy)
    expect(rows.map((r) => r.id)).toEqual(['c', 'd'])
  })
})
