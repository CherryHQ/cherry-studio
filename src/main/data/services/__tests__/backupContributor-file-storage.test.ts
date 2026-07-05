// Unit tests for the FILE_STORAGE contributor — pure declaration assertions (no DB).
import { BackupReadonlyDb } from '@main/data/db/backup/contexts'
import { table } from '@main/data/db/backup/dbSchemaRefs'
import { fileEntryTable } from '@main/data/db/schemas/file'
import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'

import { collectFileEntryIds, FILE_STORAGE_CONTRIBUTOR } from '../backupContributor-file-storage'

describe('FILE_STORAGE contributor', () => {
  it('owns file_entry only (post-#16532 file_ref split moved junctions to source domains)', () => {
    expect(FILE_STORAGE_CONTRIBUTOR.schema.tables).toEqual([table('file_entry')])
  })

  it('has no cross-domain references (file_entry has no FKs)', () => {
    expect(FILE_STORAGE_CONTRIBUTOR.schema.references).toEqual([])
  })

  it('file_entry aggregate is a non-renamable uuid-entity root', () => {
    const aggregate = FILE_STORAGE_CONTRIBUTOR.schema.aggregates[0]
    expect(aggregate.root).toBe(table('file_entry'))
    expect(aggregate.identityKey).toEqual(['id'])
    expect(aggregate.renamable).toBe(false)
  })

  it('declares no fileRefSourcePolicies (junctions belong to source domains; sourceTypes deferred)', () => {
    expect(FILE_STORAGE_CONTRIBUTOR.schema.fileRefSourcePolicies).toEqual([])
  })

  it('primary key is non-ambiguous (file_entry uuid-v7)', () => {
    for (const pk of FILE_STORAGE_CONTRIBUTOR.schema.primaryKeys) {
      expect(pk.ambiguous).toBeFalsy()
    }
  })

  it('schema is deep-frozen (mutation throws)', () => {
    expect(() => {
      ;(FILE_STORAGE_CONTRIBUTOR.schema.tables as unknown as string[]).push('x')
    }).toThrow()
  })
})

// DB-backed tests for collectFileResources — the first contributor hook with live-DB access.
describe('FILE_STORAGE collectFileResources (collectFileEntryIds)', () => {
  const dbh = setupTestDatabase()

  it('returns ids of non-deleted file_entry rows, excluding soft-deleted', async () => {
    await dbh.db
      .insert(fileEntryTable)
      .values([
        { id: 'f1', origin: 'internal', name: 'a', size: 10 },
        { id: 'f2', origin: 'internal', name: 'b', size: 20 },
        { id: 'f3', origin: 'internal', name: 'c', size: 0, deletedAt: Date.now() }
      ])
    const ids = await collectFileEntryIds(new BackupReadonlyDb(dbh.db))
    expect(ids).toEqual(new Set(['f1', 'f2']))
  })

  it('includes external entries (staging resolves their path; missing skipped later)', async () => {
    await dbh.db
      .insert(fileEntryTable)
      .values([{ id: 'ext1', origin: 'external', name: 'x', externalPath: '/abs/path/x.txt' }])
    const ids = await collectFileEntryIds(new BackupReadonlyDb(dbh.db))
    expect(ids).toEqual(new Set(['ext1']))
  })

  it('returns empty set when no file_entry rows exist', async () => {
    const ids = await collectFileEntryIds(new BackupReadonlyDb(dbh.db))
    expect(ids).toEqual(new Set())
  })
})
