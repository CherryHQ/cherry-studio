import { replayMigration, setupTestDatabase } from '@test-helpers/db'
import { asc, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import type { PosixRelativeFilePath } from '@shared/utils/file'

const BASE_ID = '11111111-1111-4111-8111-111111111111'
const DIRECTORY_ID = '0198f3f2-7d1a-7abc-8def-123456789abc'
const CHILD_FILE_ID = '0198f3f2-7d1b-7abc-8def-123456789abc'
const NOTE_ID = '0198f3f2-7d1c-7abc-8def-123456789abc'

// Letting file items use `preparing` rebuilds knowledge_item; an upgrade must keep every row and the child cascade.
describe('knowledge file preparing migrate-forward', () => {
  const dbh = setupTestDatabase()

  it('rebuilds a populated knowledge_item table without losing rows or the child cascade', () => {
    dbh.db
      .insert(knowledgeBaseTable)
      .values({ id: BASE_ID, name: 'KB', orderKey: 'a0', status: 'completed', chunkSize: 1024, chunkOverlap: 200 })
      .run()
    dbh.db
      .insert(knowledgeItemTable)
      .values([
        { id: DIRECTORY_ID, baseId: BASE_ID, type: 'directory', data: { source: '/docs' }, status: 'preparing' },
        {
          id: CHILD_FILE_ID,
          baseId: BASE_ID,
          groupId: DIRECTORY_ID,
          type: 'file',
          data: { source: '/docs/a.pdf', relativePath: 'docs/a.pdf' as PosixRelativeFilePath },
          status: 'completed'
        },
        {
          id: NOTE_ID,
          baseId: BASE_ID,
          type: 'note',
          data: { source: 'Note', content: 'Keep me' },
          status: 'failed',
          error: 'Embedding failed'
        }
      ])
      .run()
    const readItems = () => dbh.db.select().from(knowledgeItemTable).orderBy(asc(knowledgeItemTable.id)).all()
    const before = readItems()

    replayMigration(dbh, '0028_slow_ravenous')

    expect(readItems()).toEqual(before)
    expect(dbh.sqlite.pragma('foreign_key_check')).toEqual([])

    // A file may now wait in `preparing`; a note still may not.
    dbh.db
      .insert(knowledgeItemTable)
      .values({
        baseId: BASE_ID,
        type: 'file',
        data: { source: '/docs/b.pdf', relativePath: 'b.pdf' as PosixRelativeFilePath },
        status: 'preparing'
      })
      .run()
    expect(() =>
      dbh.db
        .insert(knowledgeItemTable)
        .values({ baseId: BASE_ID, type: 'note', data: { source: 'N', content: 'c' }, status: 'preparing' })
        .run()
    ).toThrow(/knowledge_item_type_status_check/)

    // Deleting a container still cascades to its expanded children after the rebuild.
    dbh.db.delete(knowledgeItemTable).where(eq(knowledgeItemTable.id, DIRECTORY_ID)).run()
    expect(dbh.db.select().from(knowledgeItemTable).where(eq(knowledgeItemTable.id, CHILD_FILE_ID)).all()).toEqual([])
  })
})
