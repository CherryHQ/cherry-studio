import { setupTestDatabase } from '@test-helpers/db'
import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  asNumericKey,
  asStringKey,
  createKeysetCursorCodec,
  decodeListCursor,
  encodeCursor,
  keysetOrdering,
  parseCursor
} from '../keysetCursor'

const encodeOpaquePayload = (payload: unknown): string =>
  Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')

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

    it('decodes separator characters in string keys', () => {
      expect(parseCursor('meeting%3Anotes:file-1', asStringKey)).toEqual({ key: 'meeting:notes', id: 'file-1' })
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
      expect(parseCursor(encodeCursor('meeting:notes', 'file-1'), asStringKey)).toEqual({
        key: 'meeting:notes',
        id: 'file-1'
      })
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

  describe('createKeysetCursorCodec', () => {
    beforeEach(() => {
      mockMainLoggerService.warn.mockClear()
    })

    it('round-trips explicit directions with numeric and string tuple boundaries', () => {
      const numericCodec = createKeysetCursorCodec({
        family: 'messages:created-at-desc',
        parseKey: asNumericKey,
        context: 'messages'
      })
      const stringCodec = createKeysetCursorCodec({
        family: 'paintings:manual-asc',
        parseKey: asStringKey,
        context: 'paintings'
      })

      const previous = numericCodec.encode({ direction: 'previous', key: 100, id: 'message:一' })
      const next = stringCodec.encode({ direction: 'next', key: 'meeting:notes', id: 'painting-1' })

      expect(previous).toMatch(/^[A-Za-z0-9_-]+$/)
      expect(next).toMatch(/^[A-Za-z0-9_-]+$/)
      expect(numericCodec.decode(previous)).toEqual({ direction: 'previous', key: 100, id: 'message:一' })
      expect(stringCodec.decode(next)).toEqual({ direction: 'next', key: 'meeting:notes', id: 'painting-1' })
      expect(mockMainLoggerService.warn).not.toHaveBeenCalled()
    })

    it('returns null without warning for an absent cursor', () => {
      const codec = createKeysetCursorCodec({
        family: 'messages:created-at-desc',
        parseKey: asNumericKey,
        context: 'messages'
      })

      expect(codec.decode(undefined)).toBeNull()
      expect(mockMainLoggerService.warn).not.toHaveBeenCalled()
    })

    it.each([
      { name: 'non-base64url token', raw: 'not+base64url', reason: 'malformed token' },
      { name: 'invalid JSON', raw: Buffer.from('{', 'utf8').toString('base64url'), reason: 'malformed token' },
      {
        name: 'wrong tuple shape',
        raw: encodeOpaquePayload([1, 'messages:created-at-desc', 'next', '100']),
        reason: 'malformed payload'
      },
      {
        name: 'unsupported version',
        raw: encodeOpaquePayload([2, 'messages:created-at-desc', 'next', '100', 'message-1']),
        reason: 'unsupported version'
      },
      {
        name: 'wrong query family',
        raw: encodeOpaquePayload([1, 'messages:created-at-asc', 'next', '100', 'message-1']),
        reason: 'cursor family mismatch'
      },
      {
        name: 'missing query family',
        raw: encodeOpaquePayload([1, null, 'next', '100', 'message-1']),
        reason: 'cursor family mismatch'
      },
      {
        name: 'invalid direction',
        raw: encodeOpaquePayload([1, 'messages:created-at-desc', 'forward', '100', 'message-1']),
        reason: 'invalid direction'
      },
      {
        name: 'empty key',
        raw: encodeOpaquePayload([1, 'messages:created-at-desc', 'next', '', 'message-1']),
        reason: 'invalid boundary'
      },
      {
        name: 'empty id',
        raw: encodeOpaquePayload([1, 'messages:created-at-desc', 'next', '100', '']),
        reason: 'invalid boundary'
      },
      {
        name: 'rejected numeric key',
        raw: encodeOpaquePayload([1, 'messages:created-at-desc', 'next', 'not-a-number', 'message-1']),
        reason: 'invalid boundary'
      }
    ])('warns once and falls back to the query head for $name', ({ raw, reason }) => {
      const codec = createKeysetCursorCodec({
        family: 'messages:created-at-desc',
        parseKey: asNumericKey,
        context: 'messages'
      })

      expect(codec.decode(raw)).toBeNull()
      expect(mockMainLoggerService.warn).toHaveBeenCalledTimes(1)
      expect(mockMainLoggerService.warn).toHaveBeenCalledWith(
        'decodeKeysetCursor: cursor invalid or incompatible, falling back to first page',
        { context: 'messages', reason }
      )
    })

    it('rejects an empty family when the codec is created', () => {
      expect(() => createKeysetCursorCodec({ family: '', parseKey: asNumericKey, context: 'messages' })).toThrow(
        'Keyset cursor family must not be empty'
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

const NUMERIC_DIRECTION_CASES = [
  { name: 'ASC / ASC', major: 'asc', tie: 'asc', canonicalIds: ['d', 'b', 'c', 'a'] },
  { name: 'ASC / DESC', major: 'asc', tie: 'desc', canonicalIds: ['d', 'c', 'b', 'a'] },
  { name: 'DESC / ASC', major: 'desc', tie: 'asc', canonicalIds: ['a', 'b', 'c', 'd'] },
  { name: 'DESC / DESC', major: 'desc', tie: 'desc', canonicalIds: ['a', 'c', 'b', 'd'] }
] as const

describe('keysetOrdering — direction coverage against real SQLite', () => {
  const dbh = setupTestDatabase()

  beforeAll(() => {
    dbh.sqlite.exec(
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

  it.each(NUMERIC_DIRECTION_CASES)(
    'returns next and previous scans in canonical order for $name',
    async ({ major, tie, canonicalIds }) => {
      const ordering = keysetOrdering(fxTable.numKey, fxTable.id, { major, tie })
      const first = FIXTURE_ROWS.find((row) => row.id === canonicalIds[0])!
      const tiedBoundary = FIXTURE_ROWS.find((row) => row.id === canonicalIds[2])!

      const nextScan = ordering.seek('next')
      const nextRows = await dbh.db
        .select({ id: fxTable.id })
        .from(fxTable)
        .where(nextScan.where({ key: first.numKey, id: first.id }))
        .orderBy(...nextScan.orderBy)
        .limit(3)
      const nextPage = nextScan.finish(nextRows, 2)

      const previousScan = ordering.seek('previous')
      const previousRows = await dbh.db
        .select({ id: fxTable.id })
        .from(fxTable)
        .where(previousScan.where({ key: tiedBoundary.numKey, id: tiedBoundary.id }))
        .orderBy(...previousScan.orderBy)
        .limit(3)
      const previousPage = previousScan.finish(previousRows, 2)

      expect(nextPage).toEqual({
        rows: [{ id: canonicalIds[1] }, { id: canonicalIds[2] }],
        hasMoreInDirection: true
      })
      expect(previousPage).toEqual({
        rows: [{ id: canonicalIds[0] }, { id: canonicalIds[1] }],
        hasMoreInDirection: false
      })
    }
  )

  it('supports bidirectional manual string ordering and restores previous rows after slicing', async () => {
    const ordering = keysetOrdering(fxTable.strKey, fxTable.id, { major: 'asc', tie: 'asc' })

    const nextScan = ordering.seek('next')
    const nextRows = await dbh.db
      .select({ id: fxTable.id })
      .from(fxTable)
      .where(nextScan.where({ key: 'A0', id: 'a' }))
      .orderBy(...nextScan.orderBy)
      .limit(3)

    const previousScan = ordering.seek('previous')
    const previousRows = await dbh.db
      .select({ id: fxTable.id })
      .from(fxTable)
      .where(previousScan.where({ key: 'A2', id: 'd' }))
      .orderBy(...previousScan.orderBy)
      .limit(3)

    expect(nextScan.finish(nextRows, 2)).toEqual({ rows: [{ id: 'b' }, { id: 'c' }], hasMoreInDirection: true })
    expect(previousScan.finish(previousRows, 2)).toEqual({
      rows: [{ id: 'b' }, { id: 'c' }],
      hasMoreInDirection: true
    })
  })
})
