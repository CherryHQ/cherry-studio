import { groupTable } from '@data/db/schemas/group'
import { knowledgeBaseTable } from '@data/db/schemas/knowledge'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import {
  KnowledgeBaseService,
  normalizeKnowledgeBaseConfigDependencies,
  validateKnowledgeBaseConfig
} from '@data/services/KnowledgeBaseService'
import { ErrorCode } from '@shared/data/api'
import type { CreateKnowledgeBaseDto } from '@shared/data/api/schemas/knowledges'
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

  /** FK targets for embedding_model_id / rerank_model_id → user_model.id */
  async function seedUserProvidersAndModelsForKb() {
    await dbh.db.insert(userProviderTable).values([
      { providerId: 'openai', name: 'OpenAI' },
      { providerId: 'cohere', name: 'Cohere' }
    ])
    await dbh.db.insert(userModelTable).values([
      {
        id: createUniqueModelId('openai', 'text-embedding-3-large'),
        providerId: 'openai',
        modelId: 'text-embedding-3-large',
        presetModelId: 'text-embedding-3-large',
        name: 'text-embedding-3-large',
        isEnabled: true,
        isHidden: false,
        sortOrder: 0
      },
      {
        id: createUniqueModelId('cohere', 'rerank-v1'),
        providerId: 'cohere',
        modelId: 'rerank-v1',
        presetModelId: 'rerank-v1',
        name: 'rerank-v1',
        isEnabled: true,
        isHidden: false,
        sortOrder: 0
      },
      {
        id: createUniqueModelId('openai', 'embed-model'),
        providerId: 'openai',
        modelId: 'embed-model',
        presetModelId: 'embed-model',
        name: 'embed-model',
        isEnabled: true,
        isHidden: false,
        sortOrder: 0
      },
      {
        id: createUniqueModelId('cohere', 'rerank-model'),
        providerId: 'cohere',
        modelId: 'rerank-model',
        presetModelId: 'rerank-model',
        name: 'rerank-model',
        isEnabled: true,
        isHidden: false,
        sortOrder: 0
      }
    ])
  }

  async function seedKnowledgeBase(overrides: Partial<typeof knowledgeBaseTable.$inferInsert> = {}) {
    const values: typeof knowledgeBaseTable.$inferInsert = {
      id: 'kb-1',
      name: 'Knowledge Base',
      description: 'Knowledge base description',
      dimensions: 1536,
      embeddingModelId: createUniqueModelId('openai', 'text-embedding-3-large'),
      rerankModelId: createUniqueModelId('cohere', 'rerank-v1'),
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

  async function seedGroup(overrides: Partial<typeof groupTable.$inferInsert> = {}) {
    const values: typeof groupTable.$inferInsert = {
      id: 'group-kb',
      entityType: 'topic',
      name: 'Knowledge Base Group',
      orderKey: 'a0',
      ...overrides
    }

    await dbh.db.insert(groupTable).values(values)
    return values
  }

  describe('list', () => {
    it('should return paginated knowledge bases', async () => {
      await seedKnowledgeBase()
      await seedKnowledgeBase({ id: 'kb-2', name: 'Another Base', description: null })

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
  })

  describe('create', () => {
    it('should create a knowledge base with trimmed identifiers', async () => {
      await seedGroup()

      const dto: CreateKnowledgeBaseDto = {
        name: '  New Base  ',
        description: 'desc',
        dimensions: 1024,
        embeddingModelId: `  ${createUniqueModelId('openai', 'embed-model')}  `,
        groupId: 'group-kb',
        emoji: '📚',
        rerankModelId: createUniqueModelId('cohere', 'rerank-model'),
        fileProcessorId: 'processor-1',
        chunkSize: 512,
        chunkOverlap: 64,
        threshold: 0.5,
        documentCount: 3,
        searchMode: 'hybrid',
        hybridAlpha: 0.6
      }

      const result = await service.create(dto)

      expect(result.name).toBe('New Base')
      expect(result.embeddingModelId).toBe(createUniqueModelId('openai', 'embed-model'))
      expect(result.groupId).toBe('group-kb')
      expect(result.emoji).toBe('📚')

      const [row] = await dbh.db.select().from(knowledgeBaseTable).where(eq(knowledgeBaseTable.id, result.id))
      expect(row.name).toBe('New Base')
      expect(row.embeddingModelId).toBe(createUniqueModelId('openai', 'embed-model'))
      expect(row.groupId).toBe('group-kb')
      expect(row.emoji).toBe('📚')
    })

    it('should apply schema chunk defaults when chunk config is omitted', async () => {
      const result = await service.create({
        name: 'Default Chunk Base',
        dimensions: 1024,
        embeddingModelId: createUniqueModelId('openai', 'embed-model')
      })

      expect(result.chunkSize).toBe(1024)
      expect(result.chunkOverlap).toBe(200)

      const [row] = await dbh.db.select().from(knowledgeBaseTable).where(eq(knowledgeBaseTable.id, result.id))
      expect(row.chunkSize).toBe(1024)
      expect(row.chunkOverlap).toBe(200)
    })

    it('should reject invalid runtime config before insert', async () => {
      const dto: CreateKnowledgeBaseDto = {
        name: 'Invalid Base',
        dimensions: 1024,
        embeddingModelId: createUniqueModelId('openai', 'embed-model'),
        chunkSize: 256,
        chunkOverlap: 256
      }

      await expect(service.create(dto)).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        details: {
          fieldErrors: {
            chunkOverlap: ['Chunk overlap must be smaller than chunk size']
          }
        }
      })

      const rows = await dbh.db.select().from(knowledgeBaseTable)
      expect(rows).toHaveLength(0)
    })

    it('should reject create when chunkOverlap is provided without chunkSize', async () => {
      await expect(
        service.create({
          name: 'Invalid Base',
          dimensions: 1024,
          embeddingModelId: createUniqueModelId('openai', 'embed-model'),
          chunkOverlap: 64
        })
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        details: {
          fieldErrors: {
            chunkSize: ['Chunk size is required when chunk overlap is provided']
          }
        }
      })
    })

    it('should accept an existing groupId without checking entityType', async () => {
      await seedGroup({ id: 'group-topic', entityType: 'topic' })

      const result = await service.create({
        name: 'New Base',
        dimensions: 1024,
        embeddingModelId: createUniqueModelId('openai', 'embed-model'),
        groupId: 'group-topic'
      })

      expect(result.groupId).toBe('group-topic')
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
        description: null,
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
      expect(row.description).toBeNull()
      expect(row.chunkSize).toBe(1024)
      expect(row.chunkOverlap).toBe(128)
      expect(row.emoji).toBe('📚')
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

    it('should not silently clean stale dependent fields during unrelated updates', async () => {
      // Seed a KB whose existing config is already inconsistent (searchMode=default
      // but hybridAlpha is populated). An unrelated field update must surface the
      // validation error rather than silently scrub the bad field.
      await seedKnowledgeBase({ searchMode: 'default', hybridAlpha: 0.7 })

      await expect(service.update('kb-1', { name: 'Renamed Base' })).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        details: {
          fieldErrors: {
            hybridAlpha: ['Hybrid alpha requires hybrid search mode']
          }
        }
      })
    })

    it('should reject explicitly provided chunkOverlap when it no longer fits chunkSize', async () => {
      await seedKnowledgeBase({ chunkSize: 256, chunkOverlap: 64 })

      await expect(
        service.update('kb-1', {
          chunkSize: 100,
          chunkOverlap: 120
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

    it('should allow moving to a valid knowledge base group without special emoji clearing logic', async () => {
      await seedGroup()
      await seedKnowledgeBase({ emoji: '📚' })

      const result = await service.update('kb-1', {
        groupId: 'group-kb'
      })

      expect(result.groupId).toBe('group-kb')
      expect(result.emoji).toBe('📚')

      const [row] = await dbh.db.select().from(knowledgeBaseTable).where(eq(knowledgeBaseTable.id, 'kb-1'))
      expect(row.groupId).toBe('group-kb')
      expect(row.emoji).toBe('📚')
    })

    it('should persist the default emoji when a legacy row still stores null', async () => {
      await seedKnowledgeBase({ emoji: null })

      const result = await service.update('kb-1', {
        emoji: '📁'
      })

      expect(result.emoji).toBe('📁')

      const [row] = await dbh.db.select().from(knowledgeBaseTable).where(eq(knowledgeBaseTable.id, 'kb-1'))
      expect(row.emoji).toBe('📁')
    })

    it('should accept an existing group during update without checking entityType', async () => {
      await seedGroup({ id: 'group-topic', entityType: 'topic' })
      await seedKnowledgeBase()

      const result = await service.update('kb-1', {
        groupId: 'group-topic'
      })

      expect(result.groupId).toBe('group-topic')
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

  describe('config helpers (pure)', () => {
    describe('normalizeKnowledgeBaseConfigDependencies', () => {
      it('should clear stale hybrid alpha after search mode changes', () => {
        expect(
          normalizeKnowledgeBaseConfigDependencies({
            searchMode: 'default' as const,
            hybridAlpha: 0.6
          })
        ).toEqual({
          searchMode: 'default',
          hybridAlpha: undefined
        })
      })
    })

    describe('validateKnowledgeBaseConfig', () => {
      it('should return field errors for invalid runtime config combinations', () => {
        expect(
          validateKnowledgeBaseConfig({
            chunkOverlap: 64,
            threshold: 1.5,
            documentCount: 0,
            searchMode: 'default',
            hybridAlpha: 2
          })
        ).toEqual({
          chunkSize: ['Chunk size is required when chunk overlap is provided'],
          threshold: ['Threshold must be between 0 and 1'],
          documentCount: ['Document count must be greater than 0'],
          hybridAlpha: ['Hybrid alpha must be between 0 and 1']
        })
      })

      it('should reject hybridAlpha when searchMode is not hybrid', () => {
        expect(
          validateKnowledgeBaseConfig({
            searchMode: 'bm25',
            hybridAlpha: 0.7
          })
        ).toEqual({
          hybridAlpha: ['Hybrid alpha requires hybrid search mode']
        })
      })

      it('should accept valid config', () => {
        expect(
          validateKnowledgeBaseConfig({
            chunkSize: 512,
            chunkOverlap: 64,
            threshold: 0.5,
            documentCount: 5,
            searchMode: 'hybrid',
            hybridAlpha: 0.7
          })
        ).toEqual({})
      })
    })
  })
})
