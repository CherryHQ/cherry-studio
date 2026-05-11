import { knowledgeBaseTable } from '@data/db/schemas/knowledge'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { KnowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { generateOrderKeySequence } from '@data/services/utils/orderKey'
import { ErrorCode } from '@shared/data/api'
import { type CreateKnowledgeBaseDto, KNOWLEDGE_BASE_ERROR_MISSING_EMBEDDING_MODEL } from '@shared/data/types/knowledge'
import { createUniqueModelId } from '@shared/data/types/model'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

describe('KnowledgeBaseService', () => {
  const dbh = setupTestDatabase()
  let service: KnowledgeBaseService

  beforeEach(async () => {
    service = new KnowledgeBaseService()
    await seedUserProvidersAndModelsForKb()
  })

  /** FK target for embedding_model_id → user_model.id */
  async function seedUserProvidersAndModelsForKb() {
    const [openaiKey] = generateOrderKeySequence(1)
    await dbh.db.insert(userProviderTable).values([{ providerId: 'openai', name: 'OpenAI', orderKey: openaiKey }])
    await dbh.db.insert(userModelTable).values([
      {
        id: createUniqueModelId('openai', 'embed-model'),
        providerId: 'openai',
        modelId: 'embed-model',
        presetModelId: 'embed-model',
        name: 'embed-model',
        isEnabled: true,
        isHidden: false
      }
    ])
  }

  async function seedKnowledgeBase(overrides: Partial<typeof knowledgeBaseTable.$inferInsert> = {}) {
    const values: typeof knowledgeBaseTable.$inferInsert = {
      id: 'kb-1',
      name: 'Knowledge Base',
      emoji: '📁',
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

  describe('list', () => {
    it('should return paginated knowledge bases', async () => {
      await seedKnowledgeBase()
      await seedKnowledgeBase({ id: 'kb-2', name: 'Another Base' })

      const result = await service.list({ page: 2, limit: 1 })

      expect(result.total).toBe(2)
      expect(result.page).toBe(2)
      expect(result.items).toHaveLength(1)
    })
  })

  describe('getById', () => {
    it('should return a knowledge base by id', async () => {
      await seedKnowledgeBase()

      const result = await service.getById('kb-1')

      expect(result).toMatchObject({
        id: 'kb-1',
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

      await expect(service.getById('kb-1')).rejects.toThrow('Chunk overlap must be smaller than chunk size')
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
      expect(result.emoji).toBe('📁')
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
      expect(row.emoji).toBe('📁')
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

      const [row] = await dbh.db.select().from(knowledgeBaseTable).where(eq(knowledgeBaseTable.id, 'kb-1'))
      expect(row).toMatchObject({
        dimensions: null,
        embeddingModelId: null,
        status: 'failed',
        error: KNOWLEDGE_BASE_ERROR_MISSING_EMBEDDING_MODEL
      })

      await expect(service.getById('kb-1')).resolves.toMatchObject({
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
          id: 'kb-failed-null-error',
          embeddingModelId: null,
          status: 'failed',
          error: null
        })
      ).rejects.toThrow()

      await expect(
        seedKnowledgeBase({
          id: 'kb-failed-empty-error',
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

      const result = await service.update('kb-1', {})

      expect(result.id).toBe('kb-1')
      expect(result.name).toBe('Knowledge Base')
    })

    it('should update and return the knowledge base', async () => {
      await seedKnowledgeBase()

      const result = await service.update('kb-1', {
        name: '  Updated Base  ',
        emoji: '📚',
        chunkSize: 1024,
        chunkOverlap: 128,
        hybridAlpha: 0.9
      })

      expect(result.name).toBe('Updated Base')
      expect(result.chunkSize).toBe(1024)
      expect(result.chunkOverlap).toBe(128)
      expect(result.hybridAlpha).toBe(0.9)
      expect(result.emoji).toBe('📚')

      const [row] = await dbh.db.select().from(knowledgeBaseTable).where(eq(knowledgeBaseTable.id, 'kb-1'))
      expect(row.name).toBe('Updated Base')
      expect(row.chunkSize).toBe(1024)
      expect(row.chunkOverlap).toBe(128)
      expect(row.emoji).toBe('📚')
    })

    it('should clear nullable processor and rerank config fields', async () => {
      await seedKnowledgeBase({
        rerankModelId: createUniqueModelId('openai', 'embed-model'),
        fileProcessorId: 'processor-1'
      })

      const result = await service.update('kb-1', {
        rerankModelId: null,
        fileProcessorId: null
      })

      expect(result.rerankModelId).toBeNull()
      expect(result.fileProcessorId).toBeNull()

      const [row] = await dbh.db.select().from(knowledgeBaseTable).where(eq(knowledgeBaseTable.id, 'kb-1'))
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

      const result = await service.update('kb-1', {
        searchMode: 'default'
      })

      expect(result.searchMode).toBe('default')
      expect(result.chunkSize).toBe(256)
      expect(result.chunkOverlap).toBe(120)
      expect(result.hybridAlpha).toBeUndefined()

      const [row] = await dbh.db.select().from(knowledgeBaseTable).where(eq(knowledgeBaseTable.id, 'kb-1'))
      expect(row.searchMode).toBe('default')
      expect(row.chunkSize).toBe(256)
      expect(row.chunkOverlap).toBe(120)
      expect(row.hybridAlpha).toBeNull()
    })

    it('should reject shrinking chunkSize when the existing chunkOverlap no longer fits', async () => {
      await seedKnowledgeBase({ chunkSize: 256, chunkOverlap: 120 })

      await expect(
        service.update('kb-1', {
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
        service.update('kb-1', {
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
        service.update('kb-1', {
          name: 'Renamed Base'
        })
      ).rejects.toThrow('Hybrid alpha requires hybrid search mode')
    })

    it('should reject explicitly provided hybridAlpha when search mode is not hybrid', async () => {
      await seedKnowledgeBase({ searchMode: 'hybrid', hybridAlpha: 0.7 })

      await expect(
        service.update('kb-1', {
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

      await expect(service.delete('kb-1')).resolves.toBeUndefined()

      const rows = await dbh.db.select().from(knowledgeBaseTable).where(eq(knowledgeBaseTable.id, 'kb-1'))
      expect(rows).toHaveLength(0)
    })

    it('should throw NotFound when deleting a missing knowledge base', async () => {
      await expect(service.delete('missing')).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
        status: 404
      })
    })
  })
})
