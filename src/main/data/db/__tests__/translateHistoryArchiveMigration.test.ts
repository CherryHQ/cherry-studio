import { resolve } from 'node:path'

import { replayMigration, setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { applyMigrations } from '@data/db/applyMigrations'
import { fileEntryTable } from '@data/db/schemas/file'
import { translateHistoryFileRefTable } from '@data/db/schemas/fileRelations'
import { translateHistoryTable } from '@data/db/schemas/translateHistory'

describe('translate history archive migrate-forward', () => {
  const dbh = setupTestDatabase()
  const fileHistoryId = '33333333-3333-4333-8333-333333333333'
  const sourceFileId = '44444444-4444-4444-8444-444444444444'
  const targetFileId = '55555555-5555-4555-8555-555555555555'
  const readHistories = () => dbh.db.select().from(translateHistoryTable).orderBy(translateHistoryTable.id).all()
  const readRefs = () =>
    dbh.db.select().from(translateHistoryFileRefTable).orderBy(translateHistoryFileRefTable.id).all()
  const readFiles = () => dbh.db.select().from(fileEntryTable).orderBy(fileEntryTable.id).all()
  let histories: ReturnType<typeof readHistories>
  let refs: ReturnType<typeof readRefs>
  let files: ReturnType<typeof readFiles>

  beforeEach(() => {
    dbh.db
      .insert(translateHistoryTable)
      .values([
        {
          id: '11111111-1111-4111-8111-111111111111',
          kind: 'text',
          sourceText: 'Original text',
          targetText: '原文',
          star: false,
          createdAt: 1000,
          updatedAt: 1100
        },
        {
          id: '22222222-2222-4222-8222-222222222222',
          kind: 'text',
          sourceText: 'Starred text',
          targetText: '收藏的文本',
          star: true,
          createdAt: 2000,
          updatedAt: 2100
        },
        {
          id: fileHistoryId,
          kind: 'file',
          sourceText: 'paper.pdf',
          targetText: 'paper.zh-CN.pdf',
          star: true,
          createdAt: 3000,
          updatedAt: 3100
        }
      ])
      .run()
    dbh.db
      .insert(fileEntryTable)
      .values([
        {
          id: sourceFileId,
          origin: 'external',
          name: 'paper',
          ext: 'pdf',
          externalPath: '/documents/paper.pdf',
          createdAt: 2900,
          updatedAt: 2950
        },
        {
          id: targetFileId,
          origin: 'internal',
          name: 'paper.zh-CN',
          ext: 'pdf',
          size: 1234,
          cleanupPolicy: 'delete_when_unreferenced',
          createdAt: 3000,
          updatedAt: 3050
        }
      ])
      .run()
    dbh.db
      .insert(translateHistoryFileRefTable)
      .values([
        {
          id: '66666666-6666-4666-8666-666666666666',
          sourceId: fileHistoryId,
          fileEntryId: targetFileId,
          role: 'target',
          createdAt: 3000,
          updatedAt: 3100
        },
        {
          id: '77777777-7777-4777-8777-777777777777',
          sourceId: fileHistoryId,
          fileEntryId: sourceFileId,
          role: 'source',
          createdAt: 3000,
          updatedAt: 3100
        }
      ])
      .run()
    histories = readHistories()
    refs = readRefs()
    files = readFiles()
    dbh.sqlite.exec('ALTER TABLE translate_history DROP COLUMN archived')
    replayMigration(dbh, '0030_messy_luminals')
  })

  it('defaults populated text and file histories to active without changing rows or file references', () => {
    expect(readHistories()).toEqual(histories)
    expect(readHistories().map((row) => row.archived)).toEqual([false, false, false])
    expect(dbh.sqlite.prepare('SELECT archived FROM translate_history ORDER BY id').all()).toEqual([
      { archived: 0 },
      { archived: 0 },
      { archived: 0 }
    ])
    expect(readRefs()).toEqual(refs)
    expect(readFiles()).toEqual(files)
    expect(dbh.sqlite.pragma('foreign_key_check')).toEqual([])
    expect(dbh.sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
  })

  it('preserves archived state and file references when migrations run again after the upgrade', () => {
    dbh.db
      .update(translateHistoryTable)
      .set({ archived: true })
      .where(eq(translateHistoryTable.id, fileHistoryId))
      .run()
    const archivedHistories = readHistories()
    expect(archivedHistories.find((row) => row.id === fileHistoryId)?.archived).toBe(true)

    applyMigrations(dbh.db, resolve('migrations/sqlite-drizzle'))

    expect(readHistories()).toEqual(archivedHistories)
    expect(readRefs()).toEqual(refs)
    expect(readFiles()).toEqual(files)
    expect(dbh.sqlite.pragma('foreign_key_check')).toEqual([])
    expect(dbh.sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
  })
})
