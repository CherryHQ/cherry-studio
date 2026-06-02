// Integration tests for `KnowledgeMigrator` reference-integrity guards.
//
// Runs FileMigrator → KnowledgeMigrator against a real SQLite DB and then
// invokes the production `PRAGMA foreign_key_check` (the same check
// `MigrationEngine.verifyForeignKeys()` runs after all migrators complete).
//
// The protections under test: `KnowledgeMigrator.execute()` must remap
// assistant knowledge-base refs from legacy IDs to migrated IDs, drop
// orphaned assistant refs, and filter dangling `file_ref` rows before the
// engine's final integrity check aborts the whole user migration.
import { assistantTable } from '@data/db/schemas/assistant'
import { assistantKnowledgeBaseTable } from '@data/db/schemas/assistantRelations'
import { fileEntryTable, fileRefTable } from '@data/db/schemas/file'
import { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'
import type { FileMetadata } from '@shared/data/types/file/legacyFileMetadata'
import { KNOWLEDGE_BASE_ERROR_MISSING_EMBEDDING_MODEL } from '@shared/data/types/knowledge'
import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it, vi } from 'vitest'

import { FileMigrator } from '../FileMigrator'
import { KNOWLEDGE_ITEM_ID_REMAP_SHARED_DATA_KEY, KnowledgeMigrator } from '../KnowledgeMigrator'

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
const ASSISTANT_ID = '11111111-1111-4111-8111-111111111111'
const FILE_SURVIVOR_ID = '019606a0-0000-7000-8000-000000000401'
const FILE_SKIPPED_ID = '019606a0-0000-7000-8000-000000000402'
const FILE_SKIPPED_A_ID = '019606a0-0000-7000-8000-000000000403'
const FILE_SKIPPED_B_ID = '019606a0-0000-7000-8000-000000000404'

function fileEntryIdAt(index: number): string {
  return `019606a0-0000-7000-8000-${String(index).padStart(12, '0')}`
}

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

async function seedAssistantKnowledgeBaseRefs(dbh: ReturnType<typeof setupTestDatabase>, knowledgeBaseIds: string[]) {
  await dbh.db.insert(assistantTable).values({
    id: ASSISTANT_ID,
    name: 'Assistant',
    emoji: '*',
    settings: DEFAULT_ASSISTANT_SETTINGS
  })

  await dbh.client.execute('PRAGMA foreign_keys = OFF')
  try {
    const now = Date.now()
    for (const knowledgeBaseId of knowledgeBaseIds) {
      await dbh.client.execute({
        sql: `
          INSERT INTO assistant_knowledge_base (assistant_id, knowledge_base_id, created_at, updated_at)
          VALUES (?, ?, ?, ?)
        `,
        args: [ASSISTANT_ID, knowledgeBaseId, now, now]
      })
    }
  } finally {
    await dbh.client.execute('PRAGMA foreign_keys = ON')
  }
}

describe('KnowledgeMigrator reference integrity guards (integration)', () => {
  const dbh = setupTestDatabase()

  it('remaps assistant knowledge base refs from legacy id to migrated id and drops orphaned refs', async () => {
    const legacyBaseId = 'legacy-kb-1'
    const orphanBaseId = 'legacy-orphan-kb'
    const migratedBaseId = '22222222-2222-4222-8222-222222222222'
    await seedAssistantKnowledgeBaseRefs(dbh, [legacyBaseId, orphanBaseId])

    const migrator = new KnowledgeMigrator() as any
    migrator.preparedBases = [
      {
        id: migratedBaseId,
        name: 'KB 1',
        groupId: null,
        dimensions: 768,
        embeddingModelId: null,
        status: 'failed',
        error: KNOWLEDGE_BASE_ERROR_MISSING_EMBEDDING_MODEL,
        rerankModelId: null,
        fileProcessorId: null,
        chunkSize: 1024,
        chunkOverlap: 200,
        threshold: null,
        documentCount: null,
        searchMode: 'hybrid',
        hybridAlpha: null,
        createdAt: 1775114958369,
        updatedAt: 1775114958369
      }
    ]
    migrator.preparedItems = []
    migrator.legacyBaseIdRemap = new Map([[legacyBaseId, migratedBaseId]])

    const result = await migrator.execute({
      db: dbh.db,
      sharedData: new Map()
    } as any)

    expect(result.success).toBe(true)
    const rows = await dbh.db
      .select({
        assistantId: assistantKnowledgeBaseTable.assistantId,
        knowledgeBaseId: assistantKnowledgeBaseTable.knowledgeBaseId
      })
      .from(assistantKnowledgeBaseTable)

    expect(rows).toEqual([{ assistantId: ASSISTANT_ID, knowledgeBaseId: migratedBaseId }])
    const fkCheck = await dbh.client.execute('PRAGMA foreign_key_check')
    expect(fkCheck.rows).toHaveLength(0)
  })

  it('drops dangling assistant knowledge base refs when no knowledge data is prepared', async () => {
    await seedAssistantKnowledgeBaseRefs(dbh, ['legacy-orphan-kb'])

    const migrator = new KnowledgeMigrator()
    const result = await migrator.execute({
      db: dbh.db
    } as any)

    expect(result).toEqual({
      success: true,
      processedCount: 0
    })
    const rows = await dbh.db.select().from(assistantKnowledgeBaseTable)
    expect(rows).toHaveLength(0)
  })

  it('drops file_refs for legacyFileIds absent from v2 file_entry so PRAGMA foreign_key_check passes', async () => {
    // Fixture: two v1 file rows, one valid and one that FileMigrator drops.
    // The KnowledgeMigrator's prepare-phase Dexie lookup still resolves both
    // ids (it reads from the same `files` export), so without the dangling
    // guard a `file_ref` row would be staged for the dropped file.
    const dexieFiles: FileMetadata[] = [
      dexieFileRow({ id: FILE_SURVIVOR_ID }),
      dexieFileRow({ id: FILE_SKIPPED_ID, size: -1 }) // FileMigrator skips: invalid size
    ]
    const reduxKnowledge = {
      bases: [
        {
          id: 'kb-1',
          name: 'KB One',
          dimensions: 1024,
          model: { id: 'emb', name: 'emb', provider: 'openai' },
          items: [
            { id: 'item-survivor', type: 'file', content: FILE_SURVIVOR_ID },
            { id: 'item-dangling', type: 'file', content: FILE_SKIPPED_ID }
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
    expect(knowledgeExecute.processedCount).toBe(2)
    const knowledgeValidate = await knowledgeMigrator.validate(ctx)
    expect(knowledgeValidate.success).toBe(true)
    expect(knowledgeValidate.stats).toMatchObject({
      sourceCount: 3,
      targetCount: 2,
      skippedCount: 1
    })
    expect(knowledgeValidate.stats.targetCount).toBe(
      knowledgeValidate.stats.sourceCount - knowledgeValidate.stats.skippedCount
    )

    const fileEntryRows = await dbh.db.select({ id: fileEntryTable.id }).from(fileEntryTable)
    expect(fileEntryRows.map((r) => r.id).sort()).toEqual([FILE_SURVIVOR_ID])

    const fileRefRows = await dbh.db
      .select({ fileEntryId: fileRefTable.fileEntryId, sourceId: fileRefTable.sourceId })
      .from(fileRefTable)
    const itemIdRemap = (ctx as unknown as { sharedData: Map<string, unknown> }).sharedData.get(
      KNOWLEDGE_ITEM_ID_REMAP_SHARED_DATA_KEY
    ) as Map<string, string>
    expect(fileRefRows).toHaveLength(1)
    expect(fileRefRows[0]).toMatchObject({ fileEntryId: FILE_SURVIVOR_ID, sourceId: itemIdRemap.get('item-survivor') })
    expect(itemIdRemap.has('item-dangling')).toBe(false)
    const knowledgeItemRows = await dbh.db.select({ id: knowledgeItemTable.id }).from(knowledgeItemTable)
    expect(knowledgeItemRows).toHaveLength(1)

    // Also exercise the post-migration check that the engine runs.
    const fkCheck = await dbh.client.execute('PRAGMA foreign_key_check')
    expect(fkCheck.rows).toHaveLength(0)
  })

  it('chunks IN query for >999 legacy file IDs without hitting SQLite parameter limit', async () => {
    const FILE_COUNT = 1200
    const dexieFiles: FileMetadata[] = Array.from({ length: FILE_COUNT }, (_, i) =>
      dexieFileRow({ id: fileEntryIdAt(i + 1000) })
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
      dexieFileRow({ id: FILE_SURVIVOR_ID }),
      dexieFileRow({ id: FILE_SKIPPED_A_ID, size: -1 }),
      dexieFileRow({ id: FILE_SKIPPED_B_ID, size: -1 })
    ]
    const reduxKnowledge = {
      bases: [
        {
          id: 'kb-1',
          name: 'KB One',
          dimensions: 1024,
          model: { id: 'emb', name: 'emb', provider: 'openai' },
          items: [
            { id: 'item-survivor', type: 'file', content: FILE_SURVIVOR_ID },
            { id: 'item-dangling-a', type: 'file', content: FILE_SKIPPED_A_ID },
            { id: 'item-dangling-b', type: 'file', content: FILE_SKIPPED_B_ID }
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
    expect(flushed).toContain(FILE_SKIPPED_A_ID)
    expect(flushed).toContain(FILE_SKIPPED_B_ID)

    // KB + valid items committed normally despite the dropped refs.
    const baseRows = await dbh.db.select().from(knowledgeBaseTable)
    expect(baseRows).toHaveLength(1)
    const itemRows = await dbh.db.select().from(knowledgeItemTable)
    expect(itemRows).toHaveLength(1)

    const fkCheck = await dbh.client.execute('PRAGMA foreign_key_check')
    expect(fkCheck.rows).toHaveLength(0)
  })
})
