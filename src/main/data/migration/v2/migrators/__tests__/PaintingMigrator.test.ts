import { fileEntryTable, fileRefTable } from '@data/db/schemas/file'
import { paintingTable } from '@data/db/schemas/painting'
import type { MigrationContext } from '@data/migration/v2/core/MigrationContext'
import { PaintingMigrator } from '@data/migration/v2/migrators/PaintingMigrator'
import { paintingSourceType } from '@shared/data/types/file'
import type { FileMetadata } from '@shared/data/types/file/legacyFileMetadata'
import { setupTestDatabase } from '@test-helpers/db'
import { asc } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

const file: FileMetadata = {
  id: '550e8400-e29b-41d4-a716-446655440001',
  name: 'file-1.png',
  origin_name: 'file-1.png',
  path: '/tmp/file-1.png',
  size: 10,
  ext: 'png',
  type: 'image',
  created_at: '2026-01-01T00:00:00.000Z',
  count: 1
}

async function insertFileEntry(dbh: ReturnType<typeof setupTestDatabase>) {
  await dbh.db.insert(fileEntryTable).values({
    id: file.id,
    origin: 'internal',
    name: 'file-1',
    ext: 'png',
    size: 10,
    externalPath: null,
    deletedAt: null,
    createdAt: Date.parse('2026-01-01T00:00:00.000Z'),
    updatedAt: Date.parse('2026-01-01T00:00:00.000Z')
  })
}

function createMigrationInput(db: MigrationContext['db'], paintings: Record<string, unknown>): MigrationContext {
  return {
    sources: {
      electronStore: { get: vi.fn() },
      reduxState: {
        get: vi.fn(),
        getCategory: vi.fn((category: string) => (category === 'paintings' ? paintings : undefined)),
        hasCategory: vi.fn(),
        getCategories: vi.fn()
      } as unknown as MigrationContext['sources']['reduxState'],
      dexieExport: {} as unknown as MigrationContext['sources']['dexieExport'],
      dexieSettings: {} as unknown as MigrationContext['sources']['dexieSettings'],
      localStorage: {} as unknown as MigrationContext['sources']['localStorage'],
      knowledgeVectorSource: {} as unknown as MigrationContext['sources']['knowledgeVectorSource'],
      legacyHomeConfig: {} as unknown as MigrationContext['sources']['legacyHomeConfig']
    },
    db,
    sharedData: new Map(),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    } as unknown as MigrationContext['logger'],
    paths: {} as unknown as MigrationContext['paths']
  }
}

describe('PaintingMigrator', () => {
  const dbh = setupTestDatabase()

  it('migrates legacy namespaces to provider/mode without storing namespace', async () => {
    await insertFileEntry(dbh)

    const migrationInput = createMigrationInput(dbh.db, {
      aihubmix_image_generate: [
        {
          id: '550e8400-e29b-41d4-a716-446655440000',
          model: 'gpt-image-1',
          prompt: 'hello',
          urls: ['https://example.com/a.png'],
          files: [file],
          quality: 'high'
        }
      ],
      ppio_edit: [
        {
          id: '550e8400-e29b-41d4-a716-446655440001',
          providerId: 'ppio-provider',
          ppioStatus: 'succeeded',
          files: [],
          ppioSeed: 42
        }
      ],
      tokenflux_paintings: [
        {
          id: '550e8400-e29b-41d4-a716-446655440002',
          status: 'processing',
          inputParams: { prompt: 'tokenflux' }
        }
      ],
      openai_image_generate: [
        {
          id: '550e8400-e29b-41d4-a716-446655440003',
          providerId: 'custom-new-api',
          model: 'gpt-image-1',
          prompt: 'new api'
        }
      ]
    })
    const migrator = new PaintingMigrator()

    await expect(migrator.prepare(migrationInput)).resolves.toMatchObject({ success: true, itemCount: 4 })
    await expect(migrator.execute(migrationInput)).resolves.toMatchObject({ success: true, processedCount: 4 })
    await expect(migrator.validate(migrationInput)).resolves.toMatchObject({ success: true })

    const rows = await dbh.db.select().from(paintingTable).orderBy(asc(paintingTable.id))
    expect(rows).toHaveLength(4)
    expect(rows.map((row) => [row.provider, row.mode])).toEqual([
      ['aihubmix', 'generate'],
      ['ppio', 'edit'],
      ['tokenflux', 'generate'],
      ['custom-new-api', 'generate']
    ])
    expect(rows[0].params).toEqual({ quality: 'high' })
    expect(rows[1].status).toBe('succeeded')
    expect(rows[1].params).toEqual({ ppioSeed: 42 })
    expect(rows[2].params).toEqual({ inputParams: { prompt: 'tokenflux' } })

    const refs = await dbh.db.select().from(fileRefTable)
    expect(refs).toMatchObject([
      {
        fileEntryId: file.id,
        sourceType: paintingSourceType,
        sourceId: '550e8400-e29b-41d4-a716-446655440000',
        role: 'image'
      }
    ])
  })

  it('fails validation when legacy painting file refs cannot be linked to file_entry rows', async () => {
    const migrationInput = createMigrationInput(dbh.db, {
      aihubmix_image_generate: [
        {
          id: '550e8400-e29b-41d4-a716-446655440020',
          prompt: 'missing file',
          files: [file]
        }
      ]
    })

    const migrator = new PaintingMigrator()
    await expect(migrator.prepare(migrationInput)).resolves.toMatchObject({ success: true, itemCount: 1 })
    await expect(migrator.execute(migrationInput)).resolves.toMatchObject({ success: true, processedCount: 1 })

    const validate = await migrator.validate(migrationInput)
    expect(validate.success).toBe(false)
    expect(validate.errors.map((error) => error.key)).toContain('painting_file_ref_skipped')
    expect(validate.diagnostics).toMatchObject({
      fileRefsExpected: 1,
      fileRefsInserted: 0,
      fileRefsSkipped: 1,
      fileRefsTargetCount: 0
    })
  })
})
