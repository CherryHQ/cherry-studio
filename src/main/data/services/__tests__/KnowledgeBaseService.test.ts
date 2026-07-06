import { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { KnowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { generateOrderKeySequence } from '@data/services/utils/orderKey'
import { ErrorCode } from '@shared/data/api/errors'
import { type CreateKnowledgeBaseDto, KNOWLEDGE_BASE_ERROR_MISSING_EMBEDDING_MODEL } from '@shared/data/types/knowledge'
import { createUniqueModelId } from '@shared/data/types/model'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

const KNOWLEDGE_BASE_ID = '11111111-1111-4111-8111-111111111111'
const SECOND_KNOWLEDGE_BASE_ID = '22222222-2222-4222-8222-222222222222'
const FAILED_NULL_ERROR_BASE_ID = '33333333-3333-4333-8333-333333333333'
const FAILED_EMPTY_ERROR_BASE_ID = '44444444-4444-4444-8444-444444444444'
const ALPHA_KNOWLEDGE_BASE_ID = '55555555-5555-4555-8555-555555555555'
const BETA_KNOWLEDGE_BASE_ID = '66666666-6666-4666-8666-666666666666'
const OTHER_KNOWLEDGE_BASE_ID = '77777777-7777-4777-8777-777777777777'
const LITERAL_KNOWLEDGE_BASE_ID = '88888888-8888-4888-8888-888888888888'
const EXPANDED_KNOWLEDGE_BASE_ID = '99999999-9999-4999-8999-999999999999'
const OLD_KNOWLEDGE_BASE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CUTOFF_KNOWLEDGE_BASE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const NEWER_KNOWLEDGE_BASE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const NEWEST_KNOWLEDGE_BASE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const FILE_ITEM_ID = '0198f3f2-7d60-7abc-8def-123456789abc'
const OTHER_BASE_FILE_ITEM_ID = '0198f3f2-7d60-7abc-8def-123456789abd'

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

  /** A second embedding model FK target, for tests that switch a base's embeddingModelId. */
  async function seedSecondEmbeddingModel() {
    const [embedModel2Key] = generateOrderKeySequence(1)
    await dbh.db.insert(userModelTable).values([
      {
        id: createUniqueModelId('openai', 'embed-model-2'),
        providerId: 'openai',
        modelId: 'embed-model-2',
        presetModelId: 'embed-model-2',
        name: 'embed-model-2',
        isEnabled: true,
        isHidden: false,
        orderKey: embedModel2Key
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
      ...overrides
    }
    await dbh.db.insert(knowledgeBaseTable).values(values)
    return values
  }

  async function seedFileKnowledgeItem(overrides: Partial<typeof knowledgeItemTable.$inferInsert> = {}) {
    await dbh.db.insert(knowledgeItemTable).values({
      id: FILE_ITEM_ID,
      baseId: KNOWLEDGE_BASE_ID,
      groupId: null,
      type: 'file',
      data: {
        source: '/docs/source-file.md',
        relativePath: 'source-file.md'
      },
      status: 'completed',
      error: null,
      ...overrides
    })
  }

  describe('list', () => {
    it('should return paginated knowledge bases', async () => {
      await seedKnowledgeBase()
      await seedKnowledgeBase({ id: SECOND_KNOWLEDGE_BASE_ID, name: 'Another Base' })

      const result = service.list({ page: 2, limit: 1 })

      expect(result.total).toBe(2)
      expect(result.page).toBe(2)
      expect(result.items).toHaveLength(1)
    })

    it('should search knowledge bases by name and keep pagination total scoped to the search', async () => {
      await seedKnowledgeBase({ id: ALPHA_KNOWLEDGE_BASE_ID, name: 'Alpha Research' })
      await seedKnowledgeBase({ id: BETA_KNOWLEDGE_BASE_ID, name: 'Beta Research' })
      await seedKnowledgeBase({ id: OTHER_KNOWLEDGE_BASE_ID, name: 'Operations' })

      const result = service.list({ page: 1, limit: 1, search: 'Research' })

      expect(result.total).toBe(2)
      expect(result.page).toBe(1)
      expect(result.items).toHaveLength(1)
      expect(result.items[0].name).toContain('Research')
    })

    it('treats % and _ in knowledge base search as literal characters', async () => {
      await seedKnowledgeBase({ id: LITERAL_KNOWLEDGE_BASE_ID, name: 'Vector 100%_notes' })
      await seedKnowledgeBase({ id: EXPANDED_KNOWLEDGE_BASE_ID, name: 'Vector 100xxnotes' })

      const result = service.list({ page: 1, limit: 10, search: '100%_' })

      expect(result.total).toBe(1)
      expect(result.items.map((item) => item.id)).toEqual([LITERAL_KNOWLEDGE_BASE_ID])
    })

    it('defaults to createdAt descending', async () => {
      await seedKnowledgeBase({ id: OLD_KNOWLEDGE_BASE_ID, name: 'Old', createdAt: 1 })
      await seedKnowledgeBase({ id: NEWER_KNOWLEDGE_BASE_ID, name: 'Newer', createdAt: 3 })
      await seedKnowledgeBase({ id: NEWEST_KNOWLEDGE_BASE_ID, name: 'Newest', createdAt: 2 })

      const result = service.list({ page: 1, limit: 10 })

      expect(result.items.map((item) => item.id)).toEqual([
        NEWER_KNOWLEDGE_BASE_ID,
        NEWEST_KNOWLEDGE_BASE_ID,
        OLD_KNOWLEDGE_BASE_ID
      ])
    })

    it('sorts by name ascending', async () => {
      await seedKnowledgeBase({ id: BETA_KNOWLEDGE_BASE_ID, name: 'Beta' })
      await seedKnowledgeBase({ id: ALPHA_KNOWLEDGE_BASE_ID, name: 'Alpha' })

      const result = service.list({ page: 1, limit: 10, sortBy: 'name', sortOrder: 'asc' })

      expect(result.items.map((item) => item.id)).toEqual([ALPHA_KNOWLEDGE_BASE_ID, BETA_KNOWLEDGE_BASE_ID])
    })

    it('filters by updatedAtFrom and can sort by updatedAt descending', async () => {
      const cutoffIso = '2026-05-01T00:00:00.000Z'
      const cutoff = Date.parse(cutoffIso)
      await seedKnowledgeBase({ id: OLD_KNOWLEDGE_BASE_ID, name: 'Research old', updatedAt: cutoff - 1 })
      await seedKnowledgeBase({ id: CUTOFF_KNOWLEDGE_BASE_ID, name: 'Research cutoff', updatedAt: cutoff })
      await seedKnowledgeBase({ id: NEWER_KNOWLEDGE_BASE_ID, name: 'Research newer', updatedAt: cutoff + 2000 })
      await seedKnowledgeBase({ id: NEWEST_KNOWLEDGE_BASE_ID, name: 'Research newest', updatedAt: cutoff + 3000 })
      await seedKnowledgeBase({ id: OTHER_KNOWLEDGE_BASE_ID, name: 'Other', updatedAt: cutoff + 4000 })

      const result = service.list({
        page: 1,
        limit: 10,
        search: 'Research',
        updatedAtFrom: cutoffIso,
        sortBy: 'updatedAt',
        sortOrder: 'desc'
      })

      expect(result.items.map((item) => item.id)).toEqual([
        NEWEST_KNOWLEDGE_BASE_ID,
        NEWER_KNOWLEDGE_BASE_ID,
        CUTOFF_KNOWLEDGE_BASE_ID
      ])
      expect(result.total).toBe(3)
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

      const result = service.list({ page: 1, limit: 10 })
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

      const firstPage = service.list({ page: 1, limit: 1 })
      const secondPage = service.list({ page: 2, limit: 1 })

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

      const result = service.search({ q: 'Needle', limit: 5 })

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

      const result = service.getById(KNOWLEDGE_BASE_ID)

      expect(result).toMatchObject({
        id: KNOWLEDGE_BASE_ID,
        name: 'Knowledge Base',
        dimensions: 1536
      })
    })

    it('should throw NotFound when the knowledge base does not exist', () => {
      let err: unknown
      try {
        service.getById('missing')
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({
        code: ErrorCode.NOT_FOUND,
        status: 404
      })
    })

    it('should reject invalid persisted chunk configuration at the read boundary', async () => {
      await seedKnowledgeBase({ chunkSize: 100, chunkOverlap: 100 })

      expect(() => service.getById(KNOWLEDGE_BASE_ID)).toThrow('Chunk overlap must be smaller than chunk size')
    })
  })

  describe('create', () => {
    it('should create a knowledge base with trimmed identifiers and defaults', async () => {
      const dto: CreateKnowledgeBaseDto = {
        name: '  New Base  ',
        dimensions: 1024,
        embeddingModelId: `  ${createUniqueModelId('openai', 'embed-model')}  `
      }

      const result = service.create(dto)

      expect(result.name).toBe('New Base')
      expect(result.embeddingModelId).toBe(createUniqueModelId('openai', 'embed-model'))
      expect(result.chunkSize).toBe(1024)
      expect(result.chunkOverlap).toBe(200)
      expect(result.searchMode).toBe('hybrid')
      expect(result.hybridAlpha).toBeUndefined()
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

    it('creates a BM25-only base when no embedding model is provided', async () => {
      const result = service.create({ name: 'Lexical Base' })

      expect(result.embeddingModelId).toBeNull()
      expect(result.dimensions).toBeNull()
      expect(result.searchMode).toBe('bm25')
      expect(result.status).toBe('completed')
      expect(result.error).toBeNull()

      const [row] = await dbh.db.select().from(knowledgeBaseTable).where(eq(knowledgeBaseTable.id, result.id))
      expect(row.embeddingModelId).toBeNull()
      expect(row.dimensions).toBeNull()
      expect(row.searchMode).toBe('bm25')
    })

    it('forces BM25 search mode without an embedding model even when another mode is requested', async () => {
      const result = service.create({ name: 'Lexical Base', searchMode: 'hybrid' })

      expect(result.embeddingModelId).toBeNull()
      expect(result.searchMode).toBe('bm25')
    })

    it('should persist a per-base hybridAlpha when provided', async () => {
      const result = service.create({
        name: 'Hybrid Tuned',
        dimensions: 1024,
        embeddingModelId: createUniqueModelId('openai', 'embed-model'),
        searchMode: 'hybrid',
        hybridAlpha: 0.8
      })

      expect(result.hybridAlpha).toBe(0.8)
      const [row] = await dbh.db.select().from(knowledgeBaseTable).where(eq(knowledgeBaseTable.id, result.id))
      expect(row.hybridAlpha).toBe(0.8)
    })

    it('rejects an explicit hybridAlpha on a no-model base instead of silently discarding it', () => {
      // Without a model, searchMode is always coerced to 'bm25' — an explicit
      // hybridAlpha is therefore never satisfiable, and create() must reject it the
      // same way update() does rather than quietly dropping it.
      let err: unknown
      try {
        service.create({ name: 'Lexical Base', hybridAlpha: 0.8 })
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        details: {
          fieldErrors: {
            hybridAlpha: ['Hybrid alpha requires hybrid search mode']
          }
        }
      })
    })

    it('rejects an embedding model without positive dimensions instead of a raw constraint violation', () => {
      // A model without dimensions would insert a row satisfying neither DB CHECK
      // arm (vector needs both; bm25-only needs neither). The IPC boundary already
      // blocks this via CreateKnowledgeBaseSchema's refine, so this guards internal
      // callers (e.g. restoreBase) that build a DTO directly.
      let err: unknown
      try {
        service.create({ name: 'Missing Dimensions', embeddingModelId: createUniqueModelId('openai', 'embed-model') })
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        details: {
          fieldErrors: {
            dimensions: ['A knowledge base with an embedding model requires positive dimensions']
          }
        }
      })
    })

    it.each([
      ['zero', 0],
      ['negative', -1],
      ['non-integer', 1.5]
    ])('rejects an embedding model with %s dimensions', (_label, dimensions) => {
      let err: unknown
      try {
        service.create({
          name: 'Invalid Dimensions',
          embeddingModelId: createUniqueModelId('openai', 'embed-model'),
          dimensions
        })
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        details: {
          fieldErrors: {
            dimensions: ['A knowledge base with an embedding model requires positive dimensions']
          }
        }
      })
    })

    it('should create a knowledge base with explicit valid chunk config', async () => {
      const dto: CreateKnowledgeBaseDto = {
        name: 'Small Chunks',
        dimensions: 1024,
        embeddingModelId: createUniqueModelId('openai', 'embed-model'),
        chunkSize: 100,
        chunkOverlap: 20
      }

      const result = service.create(dto)

      expect(result.chunkSize).toBe(100)
      expect(result.chunkOverlap).toBe(20)

      const [row] = await dbh.db.select().from(knowledgeBaseTable).where(eq(knowledgeBaseTable.id, result.id))
      expect(row.chunkSize).toBe(100)
      expect(row.chunkOverlap).toBe(20)
    })

    it('should reject create when default chunkOverlap does not fit explicit chunkSize', () => {
      let err: unknown
      try {
        service.create({
          name: 'Invalid Small Chunks',
          dimensions: 1024,
          embeddingModelId: createUniqueModelId('openai', 'embed-model'),
          chunkSize: 100
        })
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        details: {
          fieldErrors: {
            chunkOverlap: ['Chunk overlap must be smaller than chunk size']
          }
        }
      })
    })

    it('should persist an explicit chunk strategy and separator', async () => {
      const result = service.create({
        name: 'Delimiter Base',
        dimensions: 1024,
        embeddingModelId: createUniqueModelId('openai', 'embed-model'),
        chunkStrategy: 'delimiter',
        chunkSeparator: '|'
      })

      expect(result.chunkStrategy).toBe('delimiter')
      expect(result.chunkSeparator).toBe('|')

      const [row] = await dbh.db.select().from(knowledgeBaseTable).where(eq(knowledgeBaseTable.id, result.id))
      expect(row.chunkStrategy).toBe('delimiter')
      expect(row.chunkSeparator).toBe('|')
    })

    it('should reject create in delimiter mode when the separator is empty', () => {
      let err: unknown
      try {
        service.create({
          name: 'Missing Separator',
          dimensions: 1024,
          embeddingModelId: createUniqueModelId('openai', 'embed-model'),
          chunkStrategy: 'delimiter',
          chunkSeparator: ''
        })
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        details: {
          fieldErrors: {
            chunkSeparator: ['Separator is required when chunk strategy is delimiter']
          }
        }
      })
    })
  })

  describe('status constraints', () => {
    it('does not define a database default for status', () => {
      const result = dbh.sqlite.pragma('table_info(`knowledge_base`)') as Array<{ name: string; dflt_value: unknown }>
      const statusColumn = result.find((row) => row.name === 'status')

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

      expect(service.getById(KNOWLEDGE_BASE_ID)).toMatchObject({
        dimensions: null,
        embeddingModelId: null,
        status: 'failed',
        error: KNOWLEDGE_BASE_ERROR_MISSING_EMBEDDING_MODEL
      })
    })

    it('allows a completed BM25-only base with null embedding model and dimensions', async () => {
      await expect(
        seedKnowledgeBase({
          embeddingModelId: null,
          dimensions: null,
          status: 'completed',
          error: null,
          searchMode: 'bm25'
        })
      ).resolves.toBeDefined()

      expect(service.getById(KNOWLEDGE_BASE_ID)).toMatchObject({
        embeddingModelId: null,
        dimensions: null,
        status: 'completed',
        searchMode: 'bm25'
      })
    })

    it('rejects invalid persisted knowledge base status combinations', async () => {
      // A completed base's embedding model and dimensions must be set together; a
      // half-set pair is rejected (only both-set or both-null are legal).
      await expect(
        seedKnowledgeBase({
          embeddingModelId: createUniqueModelId('openai', 'embed-model'),
          dimensions: null,
          status: 'completed',
          error: null
        })
      ).rejects.toThrow()

      await expect(
        seedKnowledgeBase({
          embeddingModelId: null,
          dimensions: 1536,
          status: 'completed',
          error: null
        })
      ).rejects.toThrow()

      // A completed BM25-only base (null embedding model + dimensions) must be
      // lexical-only; a non-bm25 search mode is rejected by the DB CHECK, mirroring
      // the entity-schema invariant.
      await expect(
        seedKnowledgeBase({
          embeddingModelId: null,
          dimensions: null,
          status: 'completed',
          error: null,
          searchMode: 'hybrid'
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

      const result = service.update(KNOWLEDGE_BASE_ID, {})

      expect(result.id).toBe(KNOWLEDGE_BASE_ID)
      expect(result.name).toBe('Knowledge Base')
    })

    it('should update and return the knowledge base', async () => {
      await seedKnowledgeBase()

      const result = service.update(KNOWLEDGE_BASE_ID, {
        name: '  Updated Base  ',
        chunkSize: 1024,
        chunkOverlap: 128
      })

      expect(result.name).toBe('Updated Base')
      expect(result.chunkSize).toBe(1024)
      expect(result.chunkOverlap).toBe(128)

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

      const result = service.update(KNOWLEDGE_BASE_ID, {
        rerankModelId: null,
        fileProcessorId: null
      })

      expect(result.rerankModelId).toBeNull()
      expect(result.fileProcessorId).toBeNull()

      const [row] = await dbh.db.select().from(knowledgeBaseTable).where(eq(knowledgeBaseTable.id, KNOWLEDGE_BASE_ID))
      expect(row.rerankModelId).toBeNull()
      expect(row.fileProcessorId).toBeNull()
    })

    it('should update and persist the per-base hybridAlpha', async () => {
      await seedKnowledgeBase({ searchMode: 'hybrid' })

      const result = service.update(KNOWLEDGE_BASE_ID, { hybridAlpha: 0.9 })

      expect(result.hybridAlpha).toBe(0.9)
      const [row] = await dbh.db.select().from(knowledgeBaseTable).where(eq(knowledgeBaseTable.id, KNOWLEDGE_BASE_ID))
      expect(row.hybridAlpha).toBe(0.9)
    })

    it('should clear stale hybrid config when search mode changes during update', async () => {
      await seedKnowledgeBase({
        chunkSize: 256,
        chunkOverlap: 120,
        searchMode: 'hybrid',
        hybridAlpha: 0.7
      })

      const result = service.update(KNOWLEDGE_BASE_ID, {
        searchMode: 'vector'
      })

      expect(result.searchMode).toBe('vector')
      expect(result.chunkSize).toBe(256)
      expect(result.chunkOverlap).toBe(120)
      expect(result.hybridAlpha).toBeUndefined()

      const [row] = await dbh.db.select().from(knowledgeBaseTable).where(eq(knowledgeBaseTable.id, KNOWLEDGE_BASE_ID))
      expect(row.searchMode).toBe('vector')
      expect(row.chunkSize).toBe(256)
      expect(row.chunkOverlap).toBe(120)
      expect(row.hybridAlpha).toBeNull()
    })

    it('rejects switching a BM25-only base (no embedding model) to a non-bm25 search mode', async () => {
      await seedKnowledgeBase({ embeddingModelId: null, dimensions: null, searchMode: 'bm25' })

      let err: unknown
      try {
        service.update(KNOWLEDGE_BASE_ID, { searchMode: 'vector' })
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        details: {
          fieldErrors: {
            searchMode: ['A knowledge base without an embedding model can only use bm25 search']
          }
        }
      })

      // A no-op bm25 update on the same base is still accepted.
      const result = service.update(KNOWLEDGE_BASE_ID, { searchMode: 'bm25' })
      expect(result.searchMode).toBe('bm25')
    })

    it('allows renaming or moving a recoverable failed base despite a leftover incompatible search mode', async () => {
      // A migration-failed base can carry a pre-BM25-only searchMode (e.g. 'hybrid')
      // alongside a null embeddingModelId; the DB CHECK only constrains this pairing
      // for completed bases, so a plain metadata PATCH must not resurrect that check
      // (the no-model=>bm25 invariant is still enforced for completed bases — see
      // "rejects switching a BM25-only base" above).
      await seedKnowledgeBase({
        embeddingModelId: null,
        dimensions: null,
        status: 'failed',
        error: KNOWLEDGE_BASE_ERROR_MISSING_EMBEDDING_MODEL,
        searchMode: 'hybrid'
      })

      const result = service.update(KNOWLEDGE_BASE_ID, { name: 'Renamed while failed' })
      expect(result.name).toBe('Renamed while failed')
      expect(result.searchMode).toBe('hybrid')
    })

    it('should reject shrinking chunkSize when the existing chunkOverlap no longer fits', async () => {
      await seedKnowledgeBase({ chunkSize: 256, chunkOverlap: 120 })

      let err: unknown
      try {
        service.update(KNOWLEDGE_BASE_ID, {
          chunkSize: 100
        })
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({
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

      let err: unknown
      try {
        service.update(KNOWLEDGE_BASE_ID, {
          chunkOverlap: 256
        })
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        details: {
          fieldErrors: {
            chunkOverlap: ['Chunk overlap must be smaller than chunk size']
          }
        }
      })
    })

    it('should not silently clean stale dependent fields during unrelated updates', async () => {
      await seedKnowledgeBase({ searchMode: 'vector', hybridAlpha: 0.7 })

      expect(() =>
        service.update(KNOWLEDGE_BASE_ID, {
          name: 'Renamed Base'
        })
      ).toThrow('Hybrid alpha requires hybrid search mode')
    })

    it('should reject explicitly provided hybridAlpha when search mode is not hybrid', async () => {
      await seedKnowledgeBase({ searchMode: 'hybrid', hybridAlpha: 0.7 })

      let err: unknown
      try {
        service.update(KNOWLEDGE_BASE_ID, {
          searchMode: 'vector',
          hybridAlpha: 0.7
        })
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        details: {
          fieldErrors: {
            hybridAlpha: ['Hybrid alpha requires hybrid search mode']
          }
        }
      })
    })

    it('should reject switching to delimiter mode with an empty separator', async () => {
      await seedKnowledgeBase()

      let err: unknown
      try {
        service.update(KNOWLEDGE_BASE_ID, {
          chunkStrategy: 'delimiter',
          chunkSeparator: ''
        })
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        details: {
          fieldErrors: {
            chunkSeparator: ['Separator is required when chunk strategy is delimiter']
          }
        }
      })
    })

    it('should persist a switch to delimiter mode with a custom separator', async () => {
      await seedKnowledgeBase()

      const result = service.update(KNOWLEDGE_BASE_ID, {
        chunkStrategy: 'delimiter',
        chunkSeparator: '|'
      })

      expect(result.chunkStrategy).toBe('delimiter')
      expect(result.chunkSeparator).toBe('|')

      const [row] = await dbh.db.select().from(knowledgeBaseTable).where(eq(knowledgeBaseTable.id, KNOWLEDGE_BASE_ID))
      expect(row.chunkStrategy).toBe('delimiter')
      expect(row.chunkSeparator).toBe('|')
    })

    it('should reject switching to delimiter mode when the persisted separator is already empty', async () => {
      await seedKnowledgeBase({ chunkSeparator: '' })

      let err: unknown
      try {
        service.update(KNOWLEDGE_BASE_ID, {
          chunkStrategy: 'delimiter'
        })
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        details: {
          fieldErrors: {
            chunkSeparator: ['Separator is required when chunk strategy is delimiter']
          }
        }
      })
    })

    describe('embeddingModelId', () => {
      it('allows changing the embedding model and dimensions on a base with no items', async () => {
        await seedKnowledgeBase({ embeddingModelId: null, dimensions: null, searchMode: 'bm25' })
        await seedSecondEmbeddingModel()

        const result = service.update(KNOWLEDGE_BASE_ID, {
          embeddingModelId: createUniqueModelId('openai', 'embed-model-2'),
          dimensions: 768
        })

        expect(result.embeddingModelId).toBe(createUniqueModelId('openai', 'embed-model-2'))
        expect(result.dimensions).toBe(768)

        const [row] = await dbh.db.select().from(knowledgeBaseTable).where(eq(knowledgeBaseTable.id, KNOWLEDGE_BASE_ID))
        expect(row.embeddingModelId).toBe(createUniqueModelId('openai', 'embed-model-2'))
        expect(row.dimensions).toBe(768)
      })

      it('rejects changing the embedding model on a base that already has items', async () => {
        await seedKnowledgeBase()
        await seedSecondEmbeddingModel()
        await seedFileKnowledgeItem()

        let err: unknown
        try {
          service.update(KNOWLEDGE_BASE_ID, {
            embeddingModelId: createUniqueModelId('openai', 'embed-model-2'),
            dimensions: 768
          })
        } catch (e) {
          err = e
        }
        expect(err).toMatchObject({
          code: ErrorCode.VALIDATION_ERROR,
          details: {
            fieldErrors: {
              embeddingModelId: ['Cannot change the embedding model of a knowledge base that already has items']
            }
          }
        })

        const [row] = await dbh.db.select().from(knowledgeBaseTable).where(eq(knowledgeBaseTable.id, KNOWLEDGE_BASE_ID))
        expect(row.embeddingModelId).toBe(createUniqueModelId('openai', 'embed-model'))
      })

      it('ignores deleting items when deciding whether a base is still empty', async () => {
        await seedKnowledgeBase({ embeddingModelId: null, dimensions: null, searchMode: 'bm25' })
        await seedSecondEmbeddingModel()
        await seedFileKnowledgeItem({ status: 'deleting', error: null })

        const result = service.update(KNOWLEDGE_BASE_ID, {
          embeddingModelId: createUniqueModelId('openai', 'embed-model-2'),
          dimensions: 768
        })

        expect(result.embeddingModelId).toBe(createUniqueModelId('openai', 'embed-model-2'))
      })

      it('rejects changing dimensions alone on a base that already has items', async () => {
        await seedKnowledgeBase()
        await seedFileKnowledgeItem()

        let err: unknown
        try {
          service.update(KNOWLEDGE_BASE_ID, { dimensions: 768 })
        } catch (e) {
          err = e
        }
        expect(err).toMatchObject({
          code: ErrorCode.VALIDATION_ERROR,
          details: {
            fieldErrors: {
              embeddingModelId: ['Cannot change the embedding model of a knowledge base that already has items']
            }
          }
        })
      })
    })
  })

  describe('delete', () => {
    it('should delete an existing knowledge base', async () => {
      await seedKnowledgeBase()

      expect(service.delete(KNOWLEDGE_BASE_ID)).toBeUndefined()

      const rows = await dbh.db.select().from(knowledgeBaseTable).where(eq(knowledgeBaseTable.id, KNOWLEDGE_BASE_ID))
      expect(rows).toHaveLength(0)
    })

    it('should delete knowledge items when deleting a knowledge base', async () => {
      await seedKnowledgeBase()
      await seedKnowledgeBase({ id: SECOND_KNOWLEDGE_BASE_ID, name: 'Other Base' })
      await seedFileKnowledgeItem()
      await seedFileKnowledgeItem({ id: OTHER_BASE_FILE_ITEM_ID, baseId: SECOND_KNOWLEDGE_BASE_ID })

      service.delete(KNOWLEDGE_BASE_ID)

      const itemRows = await dbh.db.select().from(knowledgeItemTable).where(eq(knowledgeItemTable.id, FILE_ITEM_ID))
      const otherItemRows = await dbh.db
        .select()
        .from(knowledgeItemTable)
        .where(eq(knowledgeItemTable.id, OTHER_BASE_FILE_ITEM_ID))
      expect(itemRows).toHaveLength(0)
      expect(otherItemRows).toHaveLength(1)
    })

    it('should throw NotFound when deleting a missing knowledge base', () => {
      let err: unknown
      try {
        service.delete('missing')
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({
        code: ErrorCode.NOT_FOUND,
        status: 404
      })
    })
  })
})
