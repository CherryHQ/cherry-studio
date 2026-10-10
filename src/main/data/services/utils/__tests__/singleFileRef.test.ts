import { setupTestDatabase } from '@test-helpers/db'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { beforeAll, describe, expect, it } from 'vitest'

import { clearSingleFileRefTx, getSingleFileRefId, insertSingleFileRefTx, reconcileLogoSlotTx } from '../singleFileRef'

// Test-only fixture tables standing in for two different owners' slot tables
// (`provider_logo_file_ref` / `mini_app_logo_file_ref`). Not part of the
// production schema — driving the helpers with fixtures is what proves they are
// schema-agnostic rather than wired to one specific pair of tables.
const slotColumns = {
  id: text().primaryKey(),
  fileEntryId: text('file_entry_id').notNull(),
  sourceId: text('source_id').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull()
}

const fxSlotA = sqliteTable('fx_single_file_ref_a', slotColumns)
const fxSlotB = sqliteTable('fx_single_file_ref_b', slotColumns)

const FILE_A = '019606a0-0000-7000-8000-0000000000aa'
const FILE_B = '019606a0-0000-7000-8000-0000000000bb'

describe('singleFileRef', () => {
  const dbh = setupTestDatabase()

  beforeAll(() => {
    // Created directly on the shared client so they survive truncateAll (which
    // deletes rows, not schema). The unique `(source_id)` index mirrors the
    // production slot tables — it is what enforces "at most one file per owner".
    for (const table of ['fx_single_file_ref_a', 'fx_single_file_ref_b']) {
      dbh.sqlite.exec(
        `CREATE TABLE IF NOT EXISTS ${table} (
           id TEXT PRIMARY KEY,
           file_entry_id TEXT NOT NULL,
           source_id TEXT NOT NULL UNIQUE,
           created_at INTEGER NOT NULL,
           updated_at INTEGER NOT NULL
         )`
      )
    }
  })

  describe('insert / read round-trip', () => {
    it('reads back the file id written to a slot', () => {
      insertSingleFileRefTx(dbh.db, fxSlotA, 'owner-1', FILE_A)

      expect(getSingleFileRefId(fxSlotA, 'owner-1')).toBe(FILE_A)
    })

    it('returns null for an owner with no slot row', () => {
      expect(getSingleFileRefId(fxSlotA, 'owner-absent')).toBeNull()
    })
  })

  // The point of taking `table` as a parameter instead of switching on a source
  // type: a caller holding one table has no way to read or write another
  // owner's slot. These are the negative controls for that isolation.
  describe('table parameter isolates owners', () => {
    it('does not surface a row written to another table', () => {
      insertSingleFileRefTx(dbh.db, fxSlotA, 'shared-id', FILE_A)

      expect(getSingleFileRefId(fxSlotA, 'shared-id')).toBe(FILE_A)
      expect(getSingleFileRefId(fxSlotB, 'shared-id')).toBeNull()
    })

    it('keeps the same sourceId independent across tables', () => {
      insertSingleFileRefTx(dbh.db, fxSlotA, 'dup-id', FILE_A)
      insertSingleFileRefTx(dbh.db, fxSlotB, 'dup-id', FILE_B)

      expect(getSingleFileRefId(fxSlotA, 'dup-id')).toBe(FILE_A)
      expect(getSingleFileRefId(fxSlotB, 'dup-id')).toBe(FILE_B)
    })

    it('clears only the table it is given', () => {
      insertSingleFileRefTx(dbh.db, fxSlotA, 'clear-id', FILE_A)
      insertSingleFileRefTx(dbh.db, fxSlotB, 'clear-id', FILE_B)

      clearSingleFileRefTx(dbh.db, fxSlotA, 'clear-id')

      expect(getSingleFileRefId(fxSlotA, 'clear-id')).toBeNull()
      expect(getSingleFileRefId(fxSlotB, 'clear-id')).toBe(FILE_B)
    })
  })

  describe('clearSingleFileRefTx', () => {
    it('is a no-op on an empty slot', () => {
      expect(() => clearSingleFileRefTx(dbh.db, fxSlotA, 'never-set')).not.toThrow()
      expect(getSingleFileRefId(fxSlotA, 'never-set')).toBeNull()
    })
  })

  describe('reconcileLogoSlotTx', () => {
    it('returns null and leaves the slot untouched when input is undefined', () => {
      insertSingleFileRefTx(dbh.db, fxSlotA, 'r-noop', FILE_A)

      expect(reconcileLogoSlotTx(dbh.db, fxSlotA, 'r-noop', undefined)).toBeNull()
      expect(getSingleFileRefId(fxSlotA, 'r-noop')).toBe(FILE_A)
    })

    it('binds a file and nulls the logo key', () => {
      const cols = reconcileLogoSlotTx(dbh.db, fxSlotA, 'r-file', { kind: 'file', fileId: FILE_A })

      expect(cols).toEqual({ logoKey: null })
      expect(getSingleFileRefId(fxSlotA, 'r-file')).toBe(FILE_A)
    })

    it('replaces an existing file without violating the unique index', () => {
      reconcileLogoSlotTx(dbh.db, fxSlotA, 'r-replace', { kind: 'file', fileId: FILE_A })
      reconcileLogoSlotTx(dbh.db, fxSlotA, 'r-replace', { kind: 'file', fileId: FILE_B })

      expect(getSingleFileRefId(fxSlotA, 'r-replace')).toBe(FILE_B)
      const rows = dbh.sqlite.prepare('SELECT id FROM fx_single_file_ref_a WHERE source_id = ?').all('r-replace')
      expect(rows).toHaveLength(1)
    })

    it('drops the ref and returns the key for a preset key', () => {
      reconcileLogoSlotTx(dbh.db, fxSlotA, 'r-key', { kind: 'file', fileId: FILE_A })

      const cols = reconcileLogoSlotTx(dbh.db, fxSlotA, 'r-key', { kind: 'key', key: 'icon:openai' })

      expect(cols).toEqual({ logoKey: 'icon:openai' })
      expect(getSingleFileRefId(fxSlotA, 'r-key')).toBeNull()
    })

    it('drops the ref and nulls the key for default', () => {
      reconcileLogoSlotTx(dbh.db, fxSlotA, 'r-default', { kind: 'file', fileId: FILE_A })

      const cols = reconcileLogoSlotTx(dbh.db, fxSlotA, 'r-default', { kind: 'default' })

      expect(cols).toEqual({ logoKey: null })
      expect(getSingleFileRefId(fxSlotA, 'r-default')).toBeNull()
    })
  })
})
