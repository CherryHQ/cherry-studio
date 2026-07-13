// Unit tests for the FILE_STORAGE contributor — pure declaration assertions (no DB).
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { contributorManager } from '@main/services/backup/contributors/ContributorManager'
import { BackupReadonlyDb } from '@main/data/db/backup/contexts'
import { table } from '@main/data/db/backup/dbSchemaRefs'
import { fileEntryTable } from '@main/data/db/schemas/file'
import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'

import { collectFileEntryIds, FILE_STORAGE_CONTRIBUTOR, restoreFileResources } from '../backupContributorFileStorage'

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

describe('FILE_STORAGE restoreResources', () => {
  it('writes only below backupRoot and skips absolute, traversal, and symlink-escape payload ids', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cs-file-resource-hook-'))
    const archiveRoot = join(root, 'archive')
    const backupRoot = join(root, 'restore', 'resources')
    const liveFileRoot = join(root, 'Data', 'Files')
    const outside = join(root, 'outside')
    mkdirSync(join(archiveRoot, 'files'), { recursive: true })
    mkdirSync(outside)
    writeFileSync(join(archiveRoot, 'files', 'good-file'), 'good')
    writeFileSync(join(outside, 'escaped-file'), 'escaped')
    symlinkSync(join(outside, 'escaped-file'), join(archiveRoot, 'files', 'symlink-file'))

    try {
      const result = await restoreFileResources({
        registry: contributorManager.getRegistry(),
        restoreId: 'restore-1',
        domains: ['FILE_STORAGE'],
        strategy: 'SKIP',
        archiveRoot,
        backupRoot,
        liveFileRoot,
        filesAffected: new Set(['good-file', '../traversal', '/absolute', 'symlink-file'])
      })

      expect(result.restoredFileIds).toEqual(new Set(['good-file']))
      expect(result.skippedFileIds).toEqual(new Set(['../traversal', '/absolute', 'symlink-file']))
      expect(existsSync(join(backupRoot, 'files', 'good-file'))).toBe(true)
      expect(existsSync(join(liveFileRoot, 'good-file'))).toBe(false)
      expect(existsSync(join(root, 'traversal'))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('propagates destination seal failures instead of degrading them to skipped ids', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cs-file-resource-seal-failure-'))
    const archiveRoot = join(root, 'archive')
    const backupRoot = join(root, 'restore-target')
    mkdirSync(join(archiveRoot, 'files'), { recursive: true })
    writeFileSync(join(archiveRoot, 'files', 'file-seal-failure'), 'payload')
    writeFileSync(backupRoot, 'destination is not a directory')

    try {
      await expect(
        restoreFileResources({
          registry: contributorManager.getRegistry(),
          restoreId: 'restore-seal-failure',
          domains: ['FILE_STORAGE'],
          strategy: 'SKIP',
          archiveRoot,
          backupRoot,
          liveFileRoot: join(root, 'Data', 'Files'),
          filesAffected: new Set(['file-seal-failure'])
        })
      ).rejects.toThrow()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('stages a large payload through bounded-memory source-file copying', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cs-file-resource-large-'))
    const archiveRoot = join(root, 'archive')
    const backupRoot = join(root, 'restore', 'resources')
    const sourcePath = join(archiveRoot, 'files', 'large-file')
    const stagedPath = join(backupRoot, 'files', 'large-file')
    mkdirSync(join(archiveRoot, 'files'), { recursive: true })
    writeFileSync(sourcePath, Buffer.alloc(8 * 1024 * 1024, 0x5a))

    try {
      const result = await restoreFileResources({
        registry: contributorManager.getRegistry(),
        restoreId: 'restore-large',
        domains: ['FILE_STORAGE'],
        strategy: 'SKIP',
        archiveRoot,
        backupRoot,
        liveFileRoot: join(root, 'Data', 'Files'),
        filesAffected: new Set(['large-file'])
      })

      expect(result).toEqual({ restoredFileIds: new Set(['large-file']), skippedFileIds: new Set() })
      expect(statSync(stagedPath).size).toBe(statSync(sourcePath).size)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('FILE_STORAGE collectFileResources (collectFileEntryIds)', () => {
  const dbh = setupTestDatabase()

  it('returns ids of non-deleted file_entry rows, excluding soft-deleted', async () => {
    await dbh.db.insert(fileEntryTable).values([
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
