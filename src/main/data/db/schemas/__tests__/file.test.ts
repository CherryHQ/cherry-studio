/**
 * DB-level integrity tests for `file_entry` / `file_ref` schemas.
 *
 * These exercise the SQLite CHECK constraints, global unique index on
 * `externalPath`, and CASCADE FK — all of which are runtime guards we rely on
 * beyond the Zod layer. Kept separate from Zod-level shape tests (see
 * `packages/shared/data/types/__tests__/fileEntry.test.ts`).
 */

import { randomUUID } from 'node:crypto'

import { fileEntryTable, fileRefTable } from '@data/db/schemas/file'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

const TS = 1700000000000

function uuidv7(): string {
  // Simplified v7-looking value sufficient for DB uniqueness; schema tests
  // don't re-validate the UUID version (that's the Zod layer's job).
  return `019606a0-0000-7000-8000-${randomUUID().slice(-12)}`
}

function baseInternal(overrides: Record<string, unknown> = {}) {
  return {
    id: uuidv7(),
    origin: 'internal',
    name: 'doc',
    ext: 'md',
    size: 100,
    externalPath: null,
    trashedAt: null,
    createdAt: TS,
    updatedAt: TS,
    ...overrides
  }
}

function baseExternal(path: string, overrides: Record<string, unknown> = {}) {
  return {
    id: uuidv7(),
    origin: 'external',
    name: 'report',
    ext: 'pdf',
    size: null,
    externalPath: path,
    trashedAt: null,
    createdAt: TS,
    updatedAt: TS,
    ...overrides
  }
}

describe('fileEntryTable — CHECK constraints', () => {
  const dbh = setupTestDatabase()

  it('accepts a valid internal entry (externalPath=null)', async () => {
    await expect(dbh.db.insert(fileEntryTable).values(baseInternal())).resolves.not.toThrow()
  })

  it('accepts a valid external entry (externalPath non-null)', async () => {
    await expect(dbh.db.insert(fileEntryTable).values(baseExternal('/Users/me/report.pdf'))).resolves.not.toThrow()
  })

  it('rejects internal entry with non-null externalPath (fe_origin_consistency)', async () => {
    await expect(dbh.db.insert(fileEntryTable).values(baseInternal({ externalPath: '/some/path' }))).rejects.toThrow()
  })

  it('rejects external entry with null externalPath (fe_origin_consistency)', async () => {
    await expect(
      dbh.db.insert(fileEntryTable).values(baseExternal('placeholder', { externalPath: null }))
    ).rejects.toThrow()
  })

  it('rejects unknown origin value (fe_origin_check)', async () => {
    await expect(dbh.db.insert(fileEntryTable).values(baseInternal({ origin: 'remote' }))).rejects.toThrow()
  })
})

describe('fileEntryTable — global unique index on externalPath', () => {
  const dbh = setupTestDatabase()

  it('rejects two external entries with the same externalPath', async () => {
    const sharedPath = '/Users/me/shared.pdf'
    await dbh.db.insert(fileEntryTable).values(baseExternal(sharedPath))
    await expect(dbh.db.insert(fileEntryTable).values(baseExternal(sharedPath))).rejects.toThrow()
  })

  it('does not constrain internal entries (externalPath is null — SQLite NULLs are distinct)', async () => {
    await dbh.db.insert(fileEntryTable).values(baseInternal())
    await expect(dbh.db.insert(fileEntryTable).values(baseInternal())).resolves.not.toThrow()
  })
})

describe('fileEntryTable — fe_external_no_trash check', () => {
  const dbh = setupTestDatabase()

  it('rejects an external entry with non-null trashedAt', async () => {
    await expect(
      dbh.db.insert(fileEntryTable).values(baseExternal('/Users/me/will-not-trash.pdf', { trashedAt: TS }))
    ).rejects.toThrow()
  })

  it('allows internal entries to be trashed', async () => {
    await expect(dbh.db.insert(fileEntryTable).values(baseInternal({ trashedAt: TS }))).resolves.not.toThrow()
  })
})

describe('fileEntryTable — fe_size_internal_only check', () => {
  const dbh = setupTestDatabase()

  it('accepts internal size = 0 (empty file)', async () => {
    await expect(dbh.db.insert(fileEntryTable).values(baseInternal({ size: 0 }))).resolves.not.toThrow()
  })

  it('rejects internal with null size (internal size is required)', async () => {
    await expect(dbh.db.insert(fileEntryTable).values(baseInternal({ size: null }))).rejects.toThrow()
  })

  it('rejects internal with negative size', async () => {
    await expect(dbh.db.insert(fileEntryTable).values(baseInternal({ size: -1 }))).rejects.toThrow()
  })

  it('accepts external with null size', async () => {
    await expect(dbh.db.insert(fileEntryTable).values(baseExternal('/Users/me/report.pdf'))).resolves.not.toThrow()
  })

  it('rejects external with numeric size (external has no stored size)', async () => {
    await expect(
      dbh.db.insert(fileEntryTable).values(baseExternal('/Users/me/zero.pdf', { size: 0 }))
    ).rejects.toThrow()
    await expect(
      dbh.db.insert(fileEntryTable).values(baseExternal('/Users/me/big.pdf', { size: 12345 }))
    ).rejects.toThrow()
  })
})

describe('fileRefTable — CASCADE FK', () => {
  const dbh = setupTestDatabase()

  it('deleting a file_entry removes its file_ref rows via CASCADE', async () => {
    const entry = baseInternal()
    await dbh.db.insert(fileEntryTable).values(entry)

    await dbh.db.insert(fileRefTable).values({
      id: randomUUID(),
      fileEntryId: entry.id,
      sourceType: 'chat_message',
      sourceId: 'msg-1',
      role: 'attachment',
      createdAt: TS,
      updatedAt: TS
    })

    const beforeDelete = await dbh.db.select().from(fileRefTable).where(eq(fileRefTable.fileEntryId, entry.id))
    expect(beforeDelete).toHaveLength(1)

    await dbh.db.delete(fileEntryTable).where(eq(fileEntryTable.id, entry.id))

    const afterDelete = await dbh.db.select().from(fileRefTable).where(eq(fileRefTable.fileEntryId, entry.id))
    expect(afterDelete).toHaveLength(0)
  })

  it('rejects file_ref pointing to a non-existent file_entry', async () => {
    await expect(
      dbh.db.insert(fileRefTable).values({
        id: randomUUID(),
        fileEntryId: uuidv7(),
        sourceType: 'chat_message',
        sourceId: 'msg-orphan',
        role: 'attachment',
        createdAt: TS,
        updatedAt: TS
      })
    ).rejects.toThrow()
  })
})

describe('fileRefTable — unique constraint', () => {
  const dbh = setupTestDatabase()

  it('rejects duplicate (fileEntryId, sourceType, sourceId, role)', async () => {
    const entry = baseInternal()
    await dbh.db.insert(fileEntryTable).values(entry)

    const refValues = {
      fileEntryId: entry.id,
      sourceType: 'chat_message',
      sourceId: 'msg-dup',
      role: 'attachment',
      createdAt: TS,
      updatedAt: TS
    }

    await dbh.db.insert(fileRefTable).values({ id: randomUUID(), ...refValues })
    await expect(dbh.db.insert(fileRefTable).values({ id: randomUUID(), ...refValues })).rejects.toThrow()
  })

  it('allows multiple roles for the same (fileEntryId, sourceType, sourceId)', async () => {
    const entry = baseInternal()
    await dbh.db.insert(fileEntryTable).values(entry)

    const common = {
      fileEntryId: entry.id,
      sourceType: 'chat_message',
      sourceId: 'msg-multi-role',
      createdAt: TS,
      updatedAt: TS
    }

    await dbh.db.insert(fileRefTable).values({ id: randomUUID(), ...common, role: 'attachment' })
    await expect(
      dbh.db.insert(fileRefTable).values({ id: randomUUID(), ...common, role: 'source' })
    ).resolves.not.toThrow()
  })
})
