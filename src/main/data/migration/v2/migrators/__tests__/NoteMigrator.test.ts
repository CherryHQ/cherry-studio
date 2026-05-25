import { noteTable } from '@data/db/schemas/note'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { ReduxStateReader } from '../../utils/ReduxStateReader'
import { NoteMigrator } from '../NoteMigrator'

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

describe('NoteMigrator', () => {
  const dbh = setupTestDatabase()
  let migrator: NoteMigrator

  beforeEach(() => {
    migrator = new NoteMigrator()
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

  it('should migrate starred and expanded paths into note', async () => {
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

    const rows = await dbh.db.select().from(noteTable).where(eq(noteTable.rootPath, '/Users/test/Notes'))
    expect(rows).toHaveLength(2)
    expect(rows.find((row) => row.path.endsWith('/a.md'))).toMatchObject({
      isStarred: true,
      isExpanded: false
    })
    expect(rows.find((row) => row.path.endsWith('/Folder'))).toMatchObject({
      isStarred: false,
      isExpanded: true
    })
  })

  it('should trim legacy paths before migration', async () => {
    const ctx = createTestContext(
      {
        note: {
          notesPath: '  /Users/test/Notes  ',
          starredPaths: ['  /Users/test/Notes/Folder/a.md  '],
          expandedPaths: ['  /Users/test/Notes/Folder  ']
        }
      },
      dbh.db
    ) as any

    await migrator.prepare(ctx)
    await migrator.execute(ctx)

    const rows = await dbh.db.select().from(noteTable).where(eq(noteTable.rootPath, '/Users/test/Notes'))
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.path).sort()).toEqual(['/Users/test/Notes/Folder', '/Users/test/Notes/Folder/a.md'])
  })

  it('should merge migrated state into existing note rows idempotently', async () => {
    await dbh.db.insert(noteTable).values({
      rootPath: '/Users/test/Notes',
      path: '/Users/test/Notes/Folder/a.md',
      isStarred: false,
      isExpanded: true
    })
    const ctx = createTestContext(
      {
        note: {
          notesPath: '/Users/test/Notes',
          starredPaths: ['/Users/test/Notes/Folder/a.md'],
          expandedPaths: ['/Users/test/Notes/Folder/a.md']
        }
      },
      dbh.db
    ) as any

    await migrator.prepare(ctx)
    await migrator.execute(ctx)
    await migrator.execute(ctx)

    const rows = await dbh.db.select().from(noteTable).where(eq(noteTable.rootPath, '/Users/test/Notes'))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ path: '/Users/test/Notes/Folder/a.md', isStarred: true, isExpanded: true })
  })

  it('should not migrate notes when legacy notesPath is empty', async () => {
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
    const rows = await dbh.db.select().from(noteTable)
    expect(rows).toHaveLength(0)
  })
})
