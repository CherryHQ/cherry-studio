// Integration test for the `KnowledgeMigrator` dangling `file_ref` guard.
//
// Runs FileMigrator → KnowledgeMigrator against a real SQLite DB and then
// invokes the production `PRAGMA foreign_key_check` (the same check
// `MigrationEngine.verifyForeignKeys()` runs after all migrators complete).
//
// The protection under test: `KnowledgeMigrator.execute()` must filter out
// every `file_ref` whose `fileEntryId` is not actually present in the v2
// `file_entry` table, *before* the engine's post-migration foreign-key
// verification runs (the engine sets `PRAGMA foreign_keys = OFF` during
// migration, so dangling inserts succeed locally and only blow up at the
// final integrity check, aborting the entire user's migration).
import { fileEntryTable, fileRefTable } from '@data/db/schemas/file'
import { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import type { FileMetadata } from '@shared/data/types/file/legacyFileMetadata'
import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it, vi } from 'vitest'

import { FileMigrator } from '../FileMigrator'
import { KnowledgeMigrator } from '../KnowledgeMigrator'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    }))
  }
}))

const MOCK_USER_DATA = '/mock/userData'

function dexieFileRow(overrides: Partial<FileMetadata> & Pick<FileMetadata, 'id'>): FileMetadata {
  return {
    id: overrides.id,
    name: overrides.name ?? 'doc',
    origin_name: overrides.origin_name ?? 'doc.pdf',
    path: overrides.path ?? `${MOCK_USER_DATA}/Data/Files/${overrides.id}.pdf`,
    size: overrides.size ?? 1024,
    ext: overrides.ext ?? '.pdf',
    type: overrides.type ?? 'document',
    created_at: overrides.created_at ?? '2024-01-01T00:00:00.000Z',
    count: overrides.count ?? 1
  }
}

function makeCtx(dbh: ReturnType<typeof setupTestDatabase>, dexieFiles: FileMetadata[], reduxKnowledge: unknown) {
  // Minimal stand-ins for the readers FileMigrator + KnowledgeMigrator touch.
  // The full MigrationContext type has six more reader fields; cast through
  // unknown so we only mock what's actually consulted on this code path.
  return {
    sources: {
      dexieExport: {
        tableExists: vi.fn(async (name: string) => {
          if (name === 'files') return dexieFiles.length > 0
          return false
        }),
        createStreamReader: vi.fn((name: string) => ({
          readInBatches: vi.fn(async (_size: number, cb: (rows: FileMetadata[]) => Promise<void>) => {
            if (name === 'files') await cb(dexieFiles)
          })
        }))
      },
      reduxState: {
        getCategory: vi.fn(() => reduxKnowledge)
      }
    },
    db: dbh.db,
    sharedData: new Map<string, unknown>(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    paths: {
      userData: MOCK_USER_DATA,
      knowledgeBaseDir: `${MOCK_USER_DATA}/Data/KnowledgeBase`
    }
  } as never
}

describe('KnowledgeMigrator dangling file_ref guard (integration)', () => {
  const dbh = setupTestDatabase()

  it('drops file_refs for legacyFileIds absent from v2 file_entry so PRAGMA foreign_key_check passes', async () => {
    // Fixture: two v1 file rows, one valid and one that FileMigrator drops.
    // The KnowledgeMigrator's prepare-phase Dexie lookup still resolves both
    // ids (it reads from the same `files` export), so without the dangling
    // guard a `file_ref` row would be staged for the dropped file.
    const dexieFiles: FileMetadata[] = [
      dexieFileRow({ id: 'abc-survivor' }),
      dexieFileRow({ id: 'abc-skipped', size: -1 }) // FileMigrator skips: invalid size
    ]
    const reduxKnowledge = {
      bases: [
        {
          id: 'kb-1',
          name: 'KB One',
          dimensions: 1024,
          model: { id: 'emb', name: 'emb', provider: 'openai' },
          items: [
            { id: 'item-survivor', type: 'file', content: 'abc-survivor' },
            { id: 'item-dangling', type: 'file', content: 'abc-skipped' }
          ]
        }
      ]
    }

    const ctx = makeCtx(dbh, dexieFiles, reduxKnowledge)

    // Note: setupTestDatabase keeps `PRAGMA foreign_keys = ON`, which is
    // *stricter* than migration runtime (the engine sets it OFF until
    // verifyForeignKeys runs). That's deliberate here: if the dangling guard
    // ever regresses, the constraint fires immediately on insert and the
    // migrator's execute() returns success=false — same signal as the
    // production foreign_key_check, just earlier.
    const fileMigrator = new FileMigrator()
    const filePrepare = await fileMigrator.prepare(ctx)
    expect(filePrepare.success).toBe(true)
    const fileExecute = await fileMigrator.execute(ctx)
    expect(fileExecute.success).toBe(true)

    const knowledgeMigrator = new KnowledgeMigrator()
    const knowledgePrepare = await knowledgeMigrator.prepare(ctx)
    expect(knowledgePrepare.success).toBe(true)
    const knowledgeExecute = await knowledgeMigrator.execute(ctx)
    expect(knowledgeExecute.success).toBe(true)

    const fileEntryRows = await dbh.db.select({ id: fileEntryTable.id }).from(fileEntryTable)
    expect(fileEntryRows.map((r) => r.id).sort()).toEqual(['abc-survivor'])

    const fileRefRows = await dbh.db
      .select({ fileEntryId: fileRefTable.fileEntryId, sourceId: fileRefTable.sourceId })
      .from(fileRefTable)
    expect(fileRefRows).toHaveLength(1)
    expect(fileRefRows[0]).toMatchObject({ fileEntryId: 'abc-survivor', sourceId: 'item-survivor' })

    // Also exercise the post-migration check that the engine runs.
    const fkCheck = await dbh.client.execute('PRAGMA foreign_key_check')
    expect(fkCheck.rows).toHaveLength(0)
  })

  it('chunks IN query for >999 legacy file IDs without hitting SQLite parameter limit', async () => {
    const FILE_COUNT = 1200
    const dexieFiles: FileMetadata[] = Array.from({ length: FILE_COUNT }, (_, i) =>
      dexieFileRow({ id: `file-${String(i).padStart(4, '0')}` })
    )
    const items = dexieFiles.map((f) => ({
      id: `item-${f.id}`,
      type: 'file' as const,
      content: f.id
    }))
    const reduxKnowledge = {
      bases: [
        {
          id: 'kb-large',
          name: 'Large KB',
          dimensions: 1024,
          model: { id: 'emb', name: 'emb', provider: 'openai' },
          items
        }
      ]
    }

    const ctx = makeCtx(dbh, dexieFiles, reduxKnowledge)

    const fileMigrator = new FileMigrator()
    await fileMigrator.prepare(ctx)
    await fileMigrator.execute(ctx)

    const knowledgeMigrator = new KnowledgeMigrator()
    await knowledgeMigrator.prepare(ctx)
    const execute = await knowledgeMigrator.execute(ctx)
    expect(execute.success).toBe(true)

    const refRows = await dbh.db.select({ fileEntryId: fileRefTable.fileEntryId }).from(fileRefTable)
    expect(refRows).toHaveLength(FILE_COUNT)

    const fkCheck = await dbh.client.execute('PRAGMA foreign_key_check')
    expect(fkCheck.rows).toHaveLength(0)
  })

  it('records a bucketed dangling-file-entry warning that names the offending item ids', async () => {
    const dexieFiles: FileMetadata[] = [
      dexieFileRow({ id: 'abc-survivor' }),
      dexieFileRow({ id: 'abc-skipped-a', size: -1 }),
      dexieFileRow({ id: 'abc-skipped-b', size: -1 })
    ]
    const reduxKnowledge = {
      bases: [
        {
          id: 'kb-1',
          name: 'KB One',
          dimensions: 1024,
          model: { id: 'emb', name: 'emb', provider: 'openai' },
          items: [
            { id: 'item-survivor', type: 'file', content: 'abc-survivor' },
            { id: 'item-dangling-a', type: 'file', content: 'abc-skipped-a' },
            { id: 'item-dangling-b', type: 'file', content: 'abc-skipped-b' }
          ]
        }
      ]
    }
    const ctx = makeCtx(dbh, dexieFiles, reduxKnowledge)

    const fileMigrator = new FileMigrator()
    await fileMigrator.prepare(ctx)
    await fileMigrator.execute(ctx)

    const knowledgeMigrator = new KnowledgeMigrator()
    await knowledgeMigrator.prepare(ctx)
    const execute = await knowledgeMigrator.execute(ctx)
    expect(execute.success).toBe(true)

    // The dangling bucket is flushed at the end of execute(); inspect the
    // migrator's internal `warnings` field for the rolled-up summary.
    const allWarnings = (knowledgeMigrator as unknown as { warnings: string[] }).warnings
    const flushed = allWarnings.find((w) => w.includes('knowledge_item_dangling_file_entry'))
    expect(flushed).toBeDefined()
    expect(flushed).toContain('count=2')
    expect(flushed).toContain('item-dangling-a')
    expect(flushed).toContain('item-dangling-b')

    // KB + items committed normally despite the dropped refs.
    const baseRows = await dbh.db.select().from(knowledgeBaseTable)
    expect(baseRows).toHaveLength(1)
    const itemRows = await dbh.db.select().from(knowledgeItemTable)
    expect(itemRows).toHaveLength(3)

    const fkCheck = await dbh.client.execute('PRAGMA foreign_key_check')
    expect(fkCheck.rows).toHaveLength(0)
  })
})
