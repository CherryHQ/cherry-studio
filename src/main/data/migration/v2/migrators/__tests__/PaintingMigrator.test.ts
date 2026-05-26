import { paintingTable } from '@data/db/schemas/painting'
import type { MigrationContext } from '@data/migration/v2/core/MigrationContext'
import { PaintingMigrator } from '@data/migration/v2/migrators/PaintingMigrator'
import type { FileMetadata } from '@shared/data/types/file/legacyFileMetadata'
import { setupTestDatabase } from '@test-helpers/db'
import { asc } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

const file: FileMetadata = {
  id: 'file-1',
  name: 'file-1.png',
  origin_name: 'file-1.png',
  path: '/tmp/file-1.png',
  size: 10,
  ext: 'png',
  type: 'image',
  created_at: '2026-01-01T00:00:00.000Z',
  count: 1
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
    expect(rows[0].files[0]?.id).toBe(file.id)
    expect(rows[0].params).toEqual({ quality: 'high' })
    expect(rows[1].status).toBe('succeeded')
    expect(rows[1].params).toEqual({ ppioSeed: 42 })
    expect(rows[2].params).toEqual({ inputParams: { prompt: 'tokenflux' } })
  })
})
