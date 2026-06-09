import { fileEntryTable, fileRefTable } from '@data/db/schemas/file'
import { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { KnowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { generateOrderKeySequence } from '@data/services/utils/orderKey'
import { ErrorCode } from '@shared/data/api'
import type { FileEntryId } from '@shared/data/types/file'
import { knowledgeItemSourceType, tempSessionSourceType } from '@shared/data/types/file/ref'
import { type CreateKnowledgeBaseDto, KNOWLEDGE_BASE_ERROR_MISSING_EMBEDDING_MODEL } from '@shared/data/types/knowledge'
import { createUniqueModelId } from '@shared/data/types/model'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

const KNOWLEDGE_BASE_ID = '11111111-1111-4111-8111-111111111111'
const SECOND_KNOWLEDGE_BASE_ID = '22222222-2222-4222-8222-222222222222'
const FAILED_NULL_ERROR_BASE_ID = '33333333-3333-4333-8333-333333333333'
const FAILED_EMPTY_ERROR_BASE_ID = '44444444-4444-4444-8444-444444444444'
const FILE_ITEM_ID = '0198f3f2-7d60-7abc-8def-123456789abc'
const OTHER_BASE_FILE_ITEM_ID = '0198f3f2-7d60-7abc-8def-123456789abd'
const FILE_ENTRY_ID = '019606a0-0000-7000-8000-000000000a01' as FileEntryId

describe('KnowledgeBaseService', () => {
  const dbh = setupTestDatabase()
  let service: KnowledgeBaseService

  beforeEach(async () => {
    service = new KnowledgeBaseService()
    await seedUserProvidersAndModelsForKb()
  })

  /** FK target for embedding_model_id → user_model.id */
  async function seedUserProvidersAndModelsForKb() {
    const [openaiKey, embedModelKey] = generateOrderKeySequence(2)
    await dbh.db.insert(userProviderTable).values([{ providerId: 'openai', name: 'OpenAI', orderKey: openaiKey }])
    await dbh.db.insert(userModelTable).values([
      {
        id: createUniqueModelId('openai', 'embed-model'),
        providerId: 'openai',
        modelId: 'embed-model',
        presetModelId: 'embed-model',
        name: 'embed-model',
        isEnabled: true,
        isHidden: false,
        orderKey: embedModelKey
      }
    ])
  }

  async function seedKnowledgeBase(overrides: Partial<typeof knowledgeBaseTable.$inferInsert> = {}) {
    const values: typeof knowledgeBaseTable.$inferInsert = {
      id: KNOWLEDGE_BASE_ID,
      name: 'Knowledge Base',
      dimensions: 1536,
      embeddingModelId: createUniqueModelId('openai', 'embed-model'),
      status: 'completed',
      error: null,
      rerankModelId: null,
      fileProcessorId: 'processor-1',
      chunkSize: 800,
      chunkOverlap: 120,
      threshold: 0.55,
      documentCount: 5,
      searchMode: 'hybrid',
      hybridAlpha: 0.7,
      ...overrides
    }
    await dbh.db.insert(knowledgeBaseTable).values(values)
    return values
  }

  async function seedFileEntry() {
    await dbh.db.insert(fileEntryTable).values({
      id: FILE_ENTRY_ID,
      origin: 'internal',
      name: 'source-file',
      ext: 'md',
      size: 1,
      externalPath: null
    })
  }

  async function seedFileKnowledgeItem(overrides: Partial<typeof knowledgeItemTable.$inferInsert> = {}) {
    await dbh.db.insert(knowledgeItemTable).values({
      id: FILE_ITEM_ID,
      baseId: KNOWLEDGE_BASE_ID,
      groupId: null,
      type: 'file',
      data: {
        source: '/docs/source-file.md',
        fileEntryId: FILE_ENTRY_ID
      },
      status: 'completed',
      error: null,
      ...overrides
    })
  }

  async function seedKnowledgeItemFileRef(overrides: Partial<typeof fileRefTable.$inferInsert> = {}) {
    await dbh.db.insert(fileRefTable).values({
      id: '11111111-1111-4111-8111-123456789abc',
      fileEntryId: FILE_ENTRY_ID,
      sourceType: knowledgeItemSourceType,
      sourceId: FILE_ITEM_ID,
      role: 'source',
      ...overrides
    })
  }

  describe('list', () => {
    it('should return paginated knowledge bases', async () => {
      await seedKnowledgeBase()
      await seedKnowledgeBase({ id: SECOND_KNOWLEDGE_BASE_ID, name: 'Another Base' })

      const result = await service.list({ page: 2, limit: 1 })

      expect(result.total).toBe(2)
      expect(result.page).toBe(2)
      expect(result.items).toHaveLength(1)
    })

    it('should include non-deleting item counts for each knowledge base', async () => {
      await seedKnowledgeBase()
      await seedKnowledgeBase({ id: SECOND_KNOWLEDGE_BASE_ID, name: 'Another Base' })
      await dbh.db.insert(knowledgeItemTable).values([
        {
          baseId: KNOWLEDGE_BASE_ID,
          type: 'url',
          data: { source: 'https://example.com/a', url: 'https://example.com/a' },
          status: 'completed',
          error: null
        },
        {
          baseId: KNOWLEDGE_BASE_ID,
          type: 'url',
          data: { source: 'https://example.com', url: 'https://example.com' },
          status: 'failed',
          error: 'Read failed'
        },
        {
          baseId: KNOWLEDGE_BASE_ID,
          type: 'url',
          data: { source: 'https://example.com/deleting', url: 'https://example.com/deleting' },
          status: 'deleting',
          error: null
        }
      ])

      const result = await service.list({ page: 1, limit: 10 })
      const baseWithItems = result.items.find((item) => item.id === KNOWLEDGE_BASE_ID)
      const emptyBase = result.items.find((item) => item.id === SECOND_KNOWLEDGE_BASE_ID)

      expect(baseWithItems?.itemCount).toBe(2)
      expect(emptyBase?.itemCount).toBe(0)
    })

    it('should paginate grouped item counts by knowledge base rows', async () => {
      await seedKnowledgeBase({ createdAt: 2, updatedAt: 2 })
      await seedKnowledgeBase({
        id: SECOND_KNOWLEDGE_BASE_ID,
        name: 'Another Base',
        createdAt: 1,
        updatedAt: 1
      })
      await dbh.db.insert(knowledgeItemTable).values([
        {
          baseId: KNOWLEDGE_BASE_ID,
          type: 'url',
          data: { source: 'https://example.com/a', url: 'https://example.com/a' },
          status: 'completed',
          error: null
        },
        {
          baseId: KNOWLEDGE_BASE_ID,
          type: 'url',
          data: { source: 'https://example.com/b', url: 'https://example.com/b' },
          status: 'completed',
          error: null
        },
        {
          baseId: KNOWLEDGE_BASE_ID,
          type: 'url',
          data: { source: 'https://example.com/deleting', url: 'https://example.com/deleting' },
          status: 'deleting',
          error: null
        },
        {
          baseId: SECOND_KNOWLEDGE_BASE_ID,
          type: 'url',
          data: { source: 'https://example.com/other', url: 'https://example.com/other' },
          status: 'completed',
          error: null
        }
      ])

      const firstPage = await service.list({ page: 1, limit: 1 })
      const secondPage = await service.list({ page: 2, limit: 1 })

      expect(firstPage.total).toBe(2)
      expect(firstPage.items).toHaveLength(1)
      expect(firstPage.items[0]).toMatchObject({ id: KNOWLEDGE_BASE_ID, itemCount: 2 })

      expect(secondPage.total).toBe(2)
      expect(secondPage.items).toHaveLength(1)
      expect(secondPage.items[0]).toMatchObject({ id: SECOND_KNOWLEDGE_BASE_ID, itemCount: 1 })
    })
  })

  describe('search', () => {
    it('returns lean navigation items without item counts', async () => {
      await seedKnowledgeBase({
        id: KNOWLEDGE_BASE_ID,
        name: 'Needle Old Knowledge',
        updatedAt: 100
      })
      await seedKnowledgeBase({
        id: SECOND_KNOWLEDGE_BASE_ID,
        name: 'Needle New Knowledge',
        updatedAt: 200
      })
      await seedFileKnowledgeItem()

      const result = await service.search({ q: 'Needle', limit: 5 })

      expect(result).toEqual([
        {
          type: 'knowledge-base',
          id: SECOND_KNOWLEDGE_BASE_ID,
          title: 'Needle New Knowledge',
          updatedAt: '1970-01-01T00:00:00.200Z',
          target: { knowledgeBaseId: SECOND_KNOWLEDGE_BASE_ID }
        },
        {
          type: 'knowledge-base',
          id: KNOWLEDGE_BASE_ID,
          title: 'Needle Old Knowledge',
          updatedAt: '1970-01-01T00:00:00.100Z',
          target: { knowledgeBaseId: KNOWLEDGE_BASE_ID }
        }
      ])
      expect(result[0]).not.toHaveProperty('itemCount')
    })
  })

  describe('getById', () => {
    it('should return a knowledge base by id', async () => {
      await seedKnowledgeBase()

      const result = await service.getById(KNOWLEDGE_BASE_ID)

      expect(result).toMatchObject({
        id: KNOWLEDGE_BASE_ID,
        name: 'Knowledge Base',
        dimensions: 1536
      })
    })

    it('should throw NotFound when the knowledge base does not exist', async () => {
      await expect(service.getById('missing')).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
        status: 404
      })
    })

    it('should reject invalid persisted chunk configuration at the read boundary', async () => {
      await seedKnowledgeBase({ chunkSize: 100, chunkOverlap: 100 })

      await expect(service.getById(KNOWLEDGE_BASE_ID)).rejects.toThrow('Chunk overlap must be smaller than chunk size')
    })
  })

  describe('create', () => {
    it('should create a knowledge base with trimmed identifiers and defaults', async () => {
      const dto: CreateKnowledgeBaseDto = {
        name: '  New Base  ',
        dimensions: 1024,
        embeddingModelId: `  ${createUniqueModelId('openai', 'embed-model')}  `
      }

      const result = await service.create(dto)

      expect(result.name).toBe('New Base')
      expect(result.embeddingModelId).toBe(createUniqueModelId('openai', 'embed-model'))
      expect(result.chunkSize).toBe(1024)
      expect(result.chunkOverlap).toBe(200)
      expect(result.searchMode).toBe('hybrid')
      expect(result.status).toBe('completed')
      expect(result.error).toBeNull()

      const [row] = await dbh.db.select().from(knowledgeBaseTable).where(eq(knowledgeBaseTable.id, result.id))
      expect(row.name).toBe('New Base')
      expect(row.groupId).toBeNull()
      expect(row.embeddingModelId).toBe(createUniqueModelId('openai', 'embed-model'))
      expect(row.rerankModelId).toBeNull()
      expect(row.fileProcessorId).toBeNull()
      expect(row.chunkSize).toBe(1024)
      expect(row.chunkOverlap).toBe(200)
      expect(row.threshold).toBeNull()
      expect(row.documentCount).toBeNull()
      expect(row.searchMode).toBe('hybrid')
      expect(row.hybridAlpha).toBeNull()
      expect(row.status).toBe('completed')
      expect(row.error).toBeNull()
    })

    it('should create a knowledge base with explicit valid chunk config', async () => {
      const dto: CreateKnowledgeBaseDto = {
        name: 'Small Chunks',
        dimensions: 1024,
        embeddingModelId: createUniqueModelId('openai', 'embed-model'),
        chunkSize: 100,
        chunkOverlap: 20
      }

      const result = await service.create(dto)

      expect(result.chunkSize).toBe(100)
      expect(result.chunkOverlap).toBe(20)

      const [row] = await dbh.db.select().from(knowledgeBaseTable).where(eq(knowledgeBaseTable.id, result.id))
      expect(row.chunkSize).toBe(100)
      expect(row.chunkOverlap).toBe(20)
    })

    it('should reject create when default chunkOverlap does not fit explicit chunkSize', async () => {
      await expect(
        service.create({
          name: 'Invalid Small Chunks',
          dimensions: 1024,
          embeddingModelId: createUniqueModelId('openai', 'embed-model'),
          chunkSize: 100
        })
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        details: {
          fieldErrors: {
            chunkOverlap: ['Chunk overlap must be smaller than chunk size']
          }
        }
      })
    })
  })

  describe('status constraints', () => {
    it('does not define a database default for status', async () => {
      const result = await dbh.client.execute('PRAGMA table_info(`knowledge_base`)')
      const statusColumn = result.rows.find((row) => row.name === 'status')

      expect(statusColumn).toBeDefined()
      expect(statusColumn?.dflt_value).toBeNull()
    })

    it('allows persisted failed bases with null embedding model ids, null dimensions, and non-empty errors', async () => {
      await expect(
        seedKnowledgeBase({
          dimensions: null,
          embeddingModelId: null,
          status: 'failed',
          error: KNOWLEDGE_BASE_ERROR_MISSING_EMBEDDING_MODEL
        })
      ).resolves.toBeDefined()

      const [row] = await dbh.db.select().from(knowledgeBaseTable).where(eq(knowledgeBaseTable.id, KNOWLEDGE_BASE_ID))
      expect(row).toMatchObject({
        dimensions: null,
        embeddingModelId: null,
        status: 'failed',
        error: KNOWLEDGE_BASE_ERROR_MISSING_EMBEDDING_MODEL
      })

      await expect(service.getById(KNOWLEDGE_BASE_ID)).resolves.toMatchObject({
        dimensions: null,
        embeddingModelId: null,
        status: 'failed',
        error: KNOWLEDGE_BASE_ERROR_MISSING_EMBEDDING_MODEL
      })
    })

    it('rejects invalid persisted knowledge base status combinations', async () => {
      await expect(
        seedKnowledgeBase({
          embeddingModelId: null,
          dimensions: null,
          status: 'completed',
          error: null
        })
      ).rejects.toThrow()

      await expect(
        seedKnowledgeBase({
          id: FAILED_NULL_ERROR_BASE_ID,
          embeddingModelId: null,
          status: 'failed',
          error: null
        })
      ).rejects.toThrow()

      await expect(
        seedKnowledgeBase({
          id: FAILED_EMPTY_ERROR_BASE_ID,
          embeddingModelId: null,
          status: 'failed',
          error: '' as typeof knowledgeBaseTable.$inferInsert.error
        })
      ).rejects.toThrow()
    })
  })

  describe('update', () => {
    it('should return the existing knowledge base when update is empty', async () => {
      await seedKnowledgeBase()

      const result = await service.update(KNOWLEDGE_BASE_ID, {})

      expect(result.id).toBe(KNOWLEDGE_BASE_ID)
      expect(result.name).toBe('Knowledge Base')
    })

    it('should update and return the knowledge base', async () => {
      await seedKnowledgeBase()

      const result = await service.update(KNOWLEDGE_BASE_ID, {
        name: '  Updated Base  ',
        chunkSize: 1024,
        chunkOverlap: 128,
        hybridAlpha: 0.9
      })

      expect(result.name).toBe('Updated Base')
      expect(result.chunkSize).toBe(1024)
      expect(result.chunkOverlap).toBe(128)
      expect(result.hybridAlpha).toBe(0.9)

      const [row] = await dbh.db.select().from(knowledgeBaseTable).where(eq(knowledgeBaseTable.id, KNOWLEDGE_BASE_ID))
      expect(row.name).toBe('Updated Base')
      expect(row.chunkSize).toBe(1024)
      expect(row.chunkOverlap).toBe(128)
    })

    it('should clear nullable processor and rerank config fields', async () => {
      await seedKnowledgeBase({
        rerankModelId: createUniqueModelId('openai', 'embed-model'),
        fileProcessorId: 'processor-1'
      })

      const result = await service.update(KNOWLEDGE_BASE_ID, {
        rerankModelId: null,
        fileProcessorId: null
      })

      expect(result.rerankModelId).toBeNull()
      expect(result.fileProcessorId).toBeNull()

      const [row] = await dbh.db.select().from(knowledgeBaseTable).where(eq(knowledgeBaseTable.id, KNOWLEDGE_BASE_ID))
      expect(row.rerankModelId).toBeNull()
      expect(row.fileProcessorId).toBeNull()
    })

    it('should clear stale hybrid config when search mode changes during update', async () => {
      await seedKnowledgeBase({
        chunkSize: 256,
        chunkOverlap: 120,
        searchMode: 'hybrid',
        hybridAlpha: 0.7
      })

      const result = await service.update(KNOWLEDGE_BASE_ID, {
        searchMode: 'default'
      })

      expect(result.searchMode).toBe('default')
      expect(result.chunkSize).toBe(256)
      expect(result.chunkOverlap).toBe(120)
      expect(result.hybridAlpha).toBeUndefined()

      const [row] = await dbh.db.select().from(knowledgeBaseTable).where(eq(knowledgeBaseTable.id, KNOWLEDGE_BASE_ID))
      expect(row.searchMode).toBe('default')
      expect(row.chunkSize).toBe(256)
      expect(row.chunkOverlap).toBe(120)
      expect(row.hybridAlpha).toBeNull()
    })

    it('should reject shrinking chunkSize when the existing chunkOverlap no longer fits', async () => {
      await seedKnowledgeBase({ chunkSize: 256, chunkOverlap: 120 })

      await expect(
        service.update(KNOWLEDGE_BASE_ID, {
          chunkSize: 100
        })
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        details: {
          fieldErrors: {
            chunkOverlap: ['Chunk overlap must be smaller than chunk size']
          }
        }
      })
    })

    it('should reject explicitly provided chunkOverlap when it no longer fits the current chunkSize', async () => {
      await seedKnowledgeBase({ chunkSize: 256, chunkOverlap: 120 })

      await expect(
        service.update(KNOWLEDGE_BASE_ID, {
          chunkOverlap: 256
        })
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        details: {
          fieldErrors: {
            chunkOverlap: ['Chunk overlap must be smaller than chunk size']
          }
        }
      })
    })

    it('should not silently clean stale dependent fields during unrelated updates', async () => {
      await seedKnowledgeBase({ searchMode: 'default', hybridAlpha: 0.7 })

      await expect(
        service.update(KNOWLEDGE_BASE_ID, {
          name: 'Renamed Base'
        })
      ).rejects.toThrow('Hybrid alpha requires hybrid search mode')
    })

    it('should reject explicitly provided hybridAlpha when search mode is not hybrid', async () => {
      await seedKnowledgeBase({ searchMode: 'hybrid', hybridAlpha: 0.7 })

      await expect(
        service.update(KNOWLEDGE_BASE_ID, {
          searchMode: 'default',
          hybridAlpha: 0.7
        })
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        details: {
          fieldErrors: {
            hybridAlpha: ['Hybrid alpha requires hybrid search mode']
          }
        }
      })
    })
  })

  describe('delete', () => {
    it('should delete an existing knowledge base', async () => {
      await seedKnowledgeBase()

      await expect(service.delete(KNOWLEDGE_BASE_ID)).resolves.toBeUndefined()

      const rows = await dbh.db.select().from(knowledgeBaseTable).where(eq(knowledgeBaseTable.id, KNOWLEDGE_BASE_ID))
      expect(rows).toHaveLength(0)
    })

    it('should delete knowledge item file refs when deleting a knowledge base', async () => {
      await seedKnowledgeBase()
      await seedKnowledgeBase({ id: SECOND_KNOWLEDGE_BASE_ID, name: 'Other Base' })
      await seedFileEntry()
      await seedFileKnowledgeItem()
      await seedFileKnowledgeItem({ id: OTHER_BASE_FILE_ITEM_ID, baseId: SECOND_KNOWLEDGE_BASE_ID })
      await seedKnowledgeItemFileRef()
      await seedKnowledgeItemFileRef({
        id: '22222222-2222-4222-8222-123456789abc',
        sourceType: tempSessionSourceType,
        sourceId: FILE_ITEM_ID,
        role: 'pending'
      })
      await seedKnowledgeItemFileRef({
        id: '33333333-3333-4333-8333-123456789abc',
        sourceId: OTHER_BASE_FILE_ITEM_ID
      })

      await service.delete(KNOWLEDGE_BASE_ID)

      const itemRows = await dbh.db.select().from(knowledgeItemTable).where(eq(knowledgeItemTable.id, FILE_ITEM_ID))
      const otherItemRows = await dbh.db
        .select()
        .from(knowledgeItemTable)
        .where(eq(knowledgeItemTable.id, OTHER_BASE_FILE_ITEM_ID))
      const refRows = await dbh.db
        .select()
        .from(fileRefTable)
        .where(eq(fileRefTable.id, '11111111-1111-4111-8111-123456789abc'))
      const sameSourceIdOtherTypeRows = await dbh.db
        .select()
        .from(fileRefTable)
        .where(eq(fileRefTable.id, '22222222-2222-4222-8222-123456789abc'))
      const otherBaseRefRows = await dbh.db
        .select()
        .from(fileRefTable)
        .where(eq(fileRefTable.id, '33333333-3333-4333-8333-123456789abc'))
      expect(itemRows).toHaveLength(0)
      expect(otherItemRows).toHaveLength(1)
      expect(refRows).toHaveLength(0)
      expect(sameSourceIdOtherTypeRows).toHaveLength(1)
      expect(otherBaseRefRows).toHaveLength(1)
    })

    it('should throw NotFound when deleting a missing knowledge base', async () => {
      await expect(service.delete('missing')).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
        status: 404
      })
    })
  })
})
