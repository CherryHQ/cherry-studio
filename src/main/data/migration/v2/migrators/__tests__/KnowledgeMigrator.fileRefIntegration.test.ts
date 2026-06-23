// Integration tests for `KnowledgeMigrator` reference-integrity guards.
//
// Runs FileMigrator → KnowledgeMigrator against a real SQLite DB and then
// invokes the production `PRAGMA foreign_key_check` (the same check
// `MigrationEngine.verifyForeignKeys()` runs after all migrators complete).
//
// The protections under test: `KnowledgeMigrator.execute()` must remap
// assistant knowledge-base refs from legacy IDs to migrated IDs, drop
// orphaned assistant refs, and migrate legacy file items to knowledge-owned
// relative paths without creating file_ref rows.
import { assistantTable } from '@data/db/schemas/assistant'
import { assistantKnowledgeBaseTable } from '@data/db/schemas/assistantRelations'
import { fileEntryTable, fileRefTable } from '@data/db/schemas/file'
import { knowledgeItemTable } from '@data/db/schemas/knowledge'
import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'
import type { FileMetadata } from '@shared/data/types/file/legacyFileMetadata'
import { KNOWLEDGE_BASE_ERROR_MISSING_EMBEDDING_MODEL } from '@shared/data/types/knowledge'
import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it, vi } from 'vitest'

import { AssistantMigrator } from '../AssistantMigrator'
import { FileMigrator } from '../FileMigrator'
import {
  KNOWLEDGE_BASE_ID_REMAP_SHARED_DATA_KEY,
  KNOWLEDGE_ITEM_ID_REMAP_SHARED_DATA_KEY,
  KnowledgeMigrator
} from '../KnowledgeMigrator'

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

function fileEntryIdAt(index: number): string {
  return `019606a0-0000-7000-8000-${String(index).padStart(12, '0')}`
}

function dexieFileRow(overrides: Partial<FileMetadata> & Pick<FileMetadata, 'id'>): FileMetadata {
  return {
    id: overrides.id,
    name: overrides.name ?? 'doc',
    // Unique per file so migrated relativePaths (now derived from origin_name)
    // stay distinct and need no dedup suffix.
    origin_name: overrides.origin_name ?? `${overrides.id}.pdf`,
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
      knowledgeBaseDir: `${MOCK_USER_DATA}/Data/KnowledgeBase`,
      filesDataDir: `${MOCK_USER_DATA}/Data/Files`
    }
  } as never
}

async function seedAssistantKnowledgeBaseRefs(dbh: ReturnType<typeof setupTestDatabase>, knowledgeBaseIds: string[]) {
  await dbh.db.insert(assistantTable).values({
    id: ASSISTANT_ID,
    name: 'Assistant',
    emoji: '*',
    settings: DEFAULT_ASSISTANT_SETTINGS,
    orderKey: 'a0'
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

  it('preserves assistant↔KB associations across the production migrator order (KnowledgeMigrator → AssistantMigrator)', async () => {
    // Production order: KnowledgeMigrator runs at order 1.8 BEFORE AssistantMigrator at order 2.
    // v1 stores assistant.knowledge_bases[] with the legacy Redux base id; AssistantMigrator must
    // translate each junction row legacy→new (via the remap KnowledgeMigrator publishes to
    // sharedData) before inserting. Without that translation the junction row carries a legacy id
    // that never matches the new-uuid base set, so the association is silently dropped (F2).
    // This drives BOTH real migrators against one shared context — the white-box test above only
    // exercises KnowledgeMigrator's own remap UPDATE, which is dead in this order.
    const legacyBaseId = 'legacy-kb-prod-order'
    const sharedData = new Map<string, unknown>()

    const reduxKnowledge = {
      bases: [
        {
          id: legacyBaseId,
          name: 'KB One',
          // A dangling embedding model (no user_model row) migrates the base as a restorable
          // `failed` row under a fresh uuid with no vector DB access — enough to drive the
          // junction remap end to end without seeding a legacy vector store.
          model: { id: 'emb', name: 'emb', provider: 'openai' },
          items: []
        }
      ]
    }
    const reduxAssistants = {
      assistants: [
        {
          id: 'ast-prod-order',
          name: 'Assistant',
          knowledge_bases: [{ id: legacyBaseId }]
        }
      ]
    }

    const ctx = {
      sources: {
        dexieExport: {
          tableExists: vi.fn(async () => false),
          createStreamReader: vi.fn(() => ({ readInBatches: vi.fn(async () => {}) }))
        },
        reduxState: {
          getCategory: vi.fn((category: string) =>
            category === 'knowledge' ? reduxKnowledge : category === 'assistants' ? reduxAssistants : undefined
          )
        }
      },
      db: dbh.db,
      sharedData,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      paths: {
        userData: MOCK_USER_DATA,
        knowledgeBaseDir: `${MOCK_USER_DATA}/Data/KnowledgeBase`,
        filesDataDir: `${MOCK_USER_DATA}/Data/Files`
      }
    } as never

    const knowledgeMigrator = new KnowledgeMigrator()
    expect((await knowledgeMigrator.prepare(ctx)).success).toBe(true)
    expect((await knowledgeMigrator.execute(ctx)).success).toBe(true)

    const migratedBaseId = (sharedData.get(KNOWLEDGE_BASE_ID_REMAP_SHARED_DATA_KEY) as Map<string, string>).get(
      legacyBaseId
    )
    expect(migratedBaseId).toBeDefined()
    // KnowledgeMigrator mints a fresh uuid — the legacy id must not survive verbatim.
    expect(migratedBaseId).not.toBe(legacyBaseId)

    const assistantMigrator = new AssistantMigrator()
    assistantMigrator.setProgressCallback(vi.fn())
    expect((await assistantMigrator.prepare(ctx)).success).toBe(true)
    expect((await assistantMigrator.execute(ctx)).success).toBe(true)

    const rows = await dbh.db
      .select({
        assistantId: assistantKnowledgeBaseTable.assistantId,
        knowledgeBaseId: assistantKnowledgeBaseTable.knowledgeBaseId
      })
      .from(assistantKnowledgeBaseTable)

    // The association survives and points at the migrated base id, not the dropped legacy id.
    expect(rows).toEqual([{ assistantId: 'ast-prod-order', knowledgeBaseId: migratedBaseId }])
    const fkCheck = await dbh.client.execute('PRAGMA foreign_key_check')
    expect(fkCheck.rows).toHaveLength(0)
  })

  it('migrates legacy file items to relative paths without creating file_refs', async () => {
    const dexieFiles: FileMetadata[] = [
      dexieFileRow({ id: FILE_SURVIVOR_ID }),
      dexieFileRow({ id: FILE_SKIPPED_ID, size: -1 })
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
    expect(knowledgeExecute.processedCount).toBe(3)
    const knowledgeValidate = await knowledgeMigrator.validate(ctx)
    expect(knowledgeValidate.success).toBe(true)
    expect(knowledgeValidate.stats).toMatchObject({
      sourceCount: 3,
      targetCount: 3,
      skippedCount: 0
    })

    const fileEntryRows = await dbh.db.select({ id: fileEntryTable.id }).from(fileEntryTable)
    expect(fileEntryRows.map((r) => r.id).sort()).toEqual([FILE_SURVIVOR_ID])

    const itemIdRemap = (ctx as unknown as { sharedData: Map<string, unknown> }).sharedData.get(
      KNOWLEDGE_ITEM_ID_REMAP_SHARED_DATA_KEY
    ) as Map<string, string>
    expect(itemIdRemap.has('item-survivor')).toBe(true)
    expect(itemIdRemap.has('item-dangling')).toBe(true)

    const knowledgeItemRows = await dbh.db
      .select({ id: knowledgeItemTable.id, data: knowledgeItemTable.data })
      .from(knowledgeItemTable)
    expect(knowledgeItemRows).toHaveLength(2)
    expect(knowledgeItemRows.map((row) => row.data).sort((a, b) => a.source.localeCompare(b.source))).toEqual([
      {
        source: `${MOCK_USER_DATA}/Data/Files/${FILE_SURVIVOR_ID}.pdf`,
        relativePath: `${FILE_SURVIVOR_ID}.pdf`
      },
      {
        source: `${MOCK_USER_DATA}/Data/Files/${FILE_SKIPPED_ID}.pdf`,
        relativePath: `${FILE_SKIPPED_ID}.pdf`
      }
    ])

    const fileRefRows = await dbh.db.select({ fileEntryId: fileRefTable.fileEntryId }).from(fileRefTable)
    expect(fileRefRows).toHaveLength(0)

    const fkCheck = await dbh.client.execute('PRAGMA foreign_key_check')
    expect(fkCheck.rows).toHaveLength(0)
  })

  it('migrates more than 999 legacy file items without creating file_refs', async () => {
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
    expect(execute.processedCount).toBe(FILE_COUNT + 1)

    const itemRows = await dbh.db.select({ data: knowledgeItemTable.data }).from(knowledgeItemTable)
    expect(itemRows).toHaveLength(FILE_COUNT)
    expect(itemRows[0]?.data).toEqual({
      source: `${MOCK_USER_DATA}/Data/Files/${fileEntryIdAt(1000)}.pdf`,
      relativePath: `${fileEntryIdAt(1000)}.pdf`
    })

    const refRows = await dbh.db.select({ fileEntryId: fileRefTable.fileEntryId }).from(fileRefTable)
    expect(refRows).toHaveLength(0)

    const fkCheck = await dbh.client.execute('PRAGMA foreign_key_check')
    expect(fkCheck.rows).toHaveLength(0)
  })
})
