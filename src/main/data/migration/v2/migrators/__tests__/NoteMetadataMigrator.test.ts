import { noteMetadataTable } from '@data/db/schemas/noteMetadata'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { ReduxStateReader } from '../../utils/ReduxStateReader'
import { NoteMetadataMigrator } from '../NoteMetadataMigrator'

function createTestContext(reduxData: Record<string, unknown>, db: any) {
  return {
    sources: {
      electronStore: { get: () => undefined },
      reduxState: new ReduxStateReader(reduxData),
      dexieExport: { readTable: async () => [], createStreamReader: async () => null, tableExists: async () => false },
      dexieSettings: { keys: () => [], get: () => undefined },
      localStorage: { get: () => undefined, getAll: () => [] },
      knowledgeVectorSource: { hasSource: () => false },
      legacyHomeConfig: { exists: () => false, read: () => null }
    },
    db,
    sharedData: new Map<string, unknown>(),
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {}
    } as any,
    paths: {} as any
  }
}

describe('NoteMetadataMigrator', () => {
  const dbh = setupTestDatabase()
  let migrator: NoteMetadataMigrator

  beforeEach(() => {
    migrator = new NoteMetadataMigrator()
  })

  it('should skip when note state is missing', async () => {
    const ctx = createTestContext({}, dbh.db) as any

    const prepare = await migrator.prepare(ctx)
    const execute = await migrator.execute(ctx)
    const validate = await migrator.validate(ctx)

    expect(prepare).toMatchObject({ success: true, itemCount: 0 })
    expect(execute).toMatchObject({ success: true, processedCount: 0 })
    expect(validate.success).toBe(true)
  })

  it('should migrate starred and expanded paths into note_metadata', async () => {
    const ctx = createTestContext(
      {
        note: {
          activeFilePath: '/Users/test/Notes/Folder/a.md',
          activeNodeId: 'node-id',
          notesPath: '/Users/test/Notes',
          starredPaths: ['/Users/test/Notes/Folder/a.md'],
          expandedPaths: ['/Users/test/Notes/Folder']
        }
      },
      dbh.db
    ) as any

    await expect(migrator.prepare(ctx)).resolves.toMatchObject({ success: true, itemCount: 2 })
    await expect(migrator.execute(ctx)).resolves.toMatchObject({ success: true, processedCount: 2 })

    const rows = await dbh.db
      .select()
      .from(noteMetadataTable)
      .where(eq(noteMetadataTable.rootPath, '/Users/test/Notes'))
    expect(rows).toHaveLength(2)
    expect(rows.find((row) => row.path.endsWith('/a.md'))).toMatchObject({
      nodeType: 'file',
      isStarred: true,
      isExpanded: false
    })
    expect(rows.find((row) => row.path.endsWith('/Folder'))).toMatchObject({
      nodeType: 'folder',
      isStarred: false,
      isExpanded: true
    })
  })

  it('should not migrate metadata when legacy notesPath is empty', async () => {
    const ctx = createTestContext(
      {
        note: {
          notesPath: '',
          starredPaths: ['/Users/test/Notes/a.md'],
          expandedPaths: ['/Users/test/Notes']
        }
      },
      dbh.db
    ) as any

    const prepare = await migrator.prepare(ctx)
    await migrator.execute(ctx)

    expect(prepare.success).toBe(true)
    expect(prepare.itemCount).toBe(0)
    expect(prepare.warnings?.[0]).toContain('notesPath is empty')
    const rows = await dbh.db.select().from(noteMetadataTable)
    expect(rows).toHaveLength(0)
  })
})
