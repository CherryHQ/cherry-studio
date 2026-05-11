import { assistantTable } from '@data/db/schemas/assistant'
import { assistantKnowledgeBaseTable, assistantMcpServerTable } from '@data/db/schemas/assistantRelations'
import { knowledgeBaseTable } from '@data/db/schemas/knowledge'
import { mcpServerTable } from '@data/db/schemas/mcpServer'
import { pinTable } from '@data/db/schemas/pin'
import { entityTagTable, tagTable } from '@data/db/schemas/tagging'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { AssistantDataService, assistantDataService } from '@data/services/AssistantService'
import { ErrorCode } from '@shared/data/api'
import { type ListAssistantsQuery, ListAssistantsQuerySchema } from '@shared/data/api/schemas/assistants'
import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'
import { createUniqueModelId } from '@shared/data/types/model'
import { setupTestDatabase } from '@test-helpers/db'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Build a `ListAssistantsQuery` through the real zod schema so `page` / `limit`
 * defaults are exercised the same way the handler applies them. Tests stay
 * terse (`listQuery({ search: 'x' })`) while still proving the schema contract.
 */
const listQuery = (overrides: Partial<ListAssistantsQuery> = {}): ListAssistantsQuery =>
  ListAssistantsQuerySchema.parse(overrides)

describe('AssistantDataService', () => {
  const dbh = setupTestDatabase()

  beforeEach(async () => {
    // Reset preference state between tests so one test's
    // `chat.default_model_id` override does not leak into the next.
    MockMainPreferenceServiceUtils.resetMocks()
    await seedModelRefs()
  })

  async function seedModelRefs() {
    await dbh.db.insert(userProviderTable).values([
      { providerId: 'openai', name: 'OpenAI' },
      { providerId: 'anthropic', name: 'Anthropic' }
    ])

    await dbh.db.insert(userModelTable).values([
      {
        id: createUniqueModelId('openai', 'gpt-4'),
        providerId: 'openai',
        modelId: 'gpt-4',
        presetModelId: 'gpt-4',
        name: 'GPT-4',
        isEnabled: true,
        isHidden: false,
        sortOrder: 0
      },
      {
        id: createUniqueModelId('anthropic', 'claude-3'),
        providerId: 'anthropic',
        modelId: 'claude-3',
        presetModelId: 'claude-3',
        name: 'Claude 3',
        isEnabled: true,
        isHidden: false,
        sortOrder: 0
      },
      {
        id: createUniqueModelId('openai', 'text-embedding-3-large'),
        providerId: 'openai',
        modelId: 'text-embedding-3-large',
        presetModelId: 'text-embedding-3-large',
        name: 'text-embedding-3-large',
        isEnabled: true,
        isHidden: false,
        sortOrder: 0
      }
    ])
  }

  async function seedMcpServer(id = 'srv-1', name = 'MCP') {
    await dbh.db.insert(mcpServerTable).values({ id, name })
  }

  async function seedKnowledgeBase(id = 'kb-1') {
    await dbh.db.insert(knowledgeBaseTable).values({
      id,
      name: 'KB',
      emoji: '📁',
      dimensions: 1024,
      embeddingModelId: createUniqueModelId('openai', 'text-embedding-3-large'),
      status: 'completed',
      error: null,
      chunkSize: 1024,
      chunkOverlap: 200,
      searchMode: 'hybrid'
    })
  }

  // Raw-insert helper that fills the NOT-NULL columns the DB has no DEFAULT for (emoji / settings).
  // Tests that exercise read-path semantics on hand-crafted rows go through this helper so they
  // don't need to repeat boilerplate every call site.
  type SeedAssistantValues = Partial<typeof assistantTable.$inferInsert>
  async function seedAssistantRow(values: SeedAssistantValues | SeedAssistantValues[]) {
    const rows = Array.isArray(values) ? values : [values]
    await dbh.db.insert(assistantTable).values(
      rows.map((v) => ({
        emoji: '🌟',
        settings: DEFAULT_ASSISTANT_SETTINGS,
        name: 'test',
        ...v
      }))
    )
  }

  it('should export a module-level singleton', () => {
    expect(assistantDataService).toBeInstanceOf(AssistantDataService)
  })

  describe('getById', () => {
    it('should return an assistant with relation ids when found', async () => {
      await seedAssistantRow({ id: 'ast-1', name: 'test', modelId: 'openai::gpt-4' })
      await seedMcpServer()
      await seedKnowledgeBase()
      await dbh.db.insert(assistantMcpServerTable).values({ assistantId: 'ast-1', mcpServerId: 'srv-1' })
      await dbh.db.insert(assistantKnowledgeBaseTable).values({ assistantId: 'ast-1', knowledgeBaseId: 'kb-1' })

      const result = await assistantDataService.getById('ast-1')

      expect(result.id).toBe('ast-1')
      expect(result.name).toBe('test')
      expect(result.modelId).toBe('openai::gpt-4')
      expect(result.mcpServerIds).toEqual(['srv-1'])
      expect(result.knowledgeBaseIds).toEqual(['kb-1'])
      expect(typeof result.createdAt).toBe('string')
    })

    it('should return null modelId when not set', async () => {
      await seedAssistantRow({ id: 'ast-1', name: 'test' })

      const result = await assistantDataService.getById('ast-1')
      expect(result.modelId).toBeNull()
    })

    it('should surface DB DEFAULT empty strings for prompt and description', async () => {
      // emoji and settings are NOT NULL with no DB DEFAULT, so the helper supplies them.
      // prompt and description carry DB DEFAULT '' — confirm SQLite fills them when omitted.
      await seedAssistantRow({ id: 'ast-1', name: 'test' })

      const result = await assistantDataService.getById('ast-1')
      expect(result.prompt).toBe('')
      expect(result.description).toBe('')
      expect(result.mcpServerIds).toEqual([])
      expect(result.knowledgeBaseIds).toEqual([])
    })

    it('should return soft-deleted assistant when includeDeleted is true', async () => {
      await seedAssistantRow({ id: 'ast-1', name: 'test' })
      await dbh.db.update(assistantTable).set({ deletedAt: Date.now() })

      const result = await assistantDataService.getById('ast-1', { includeDeleted: true })
      expect(result.id).toBe('ast-1')
    })

    it('should NOT return soft-deleted assistant by default', async () => {
      await seedAssistantRow({ id: 'ast-1', name: 'test' })
      await dbh.db.update(assistantTable).set({ deletedAt: Date.now() })

      await expect(assistantDataService.getById('ast-1')).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })

    it('should throw NOT_FOUND when assistant does not exist', async () => {
      await expect(assistantDataService.getById('non-existent')).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })

    it('should embed bound tags via inline JOIN', async () => {
      await seedAssistantRow({ id: 'ast-1', name: 'test' })
      await dbh.db.insert(tagTable).values([
        { id: '11111111-1111-4111-8111-111111111111', name: 'work', color: '#FF0000' },
        { id: '22222222-2222-4222-8222-222222222222', name: 'personal', color: null }
      ])
      await dbh.db.insert(entityTagTable).values([
        {
          entityType: 'assistant',
          entityId: 'ast-1',
          tagId: '11111111-1111-4111-8111-111111111111'
        },
        {
          entityType: 'assistant',
          entityId: 'ast-1',
          tagId: '22222222-2222-4222-8222-222222222222'
        }
      ])

      const result = await assistantDataService.getById('ast-1')

      expect(result.tags).toHaveLength(2)
      const workTag = result.tags.find((tag) => tag.name === 'work')
      const personalTag = result.tags.find((tag) => tag.name === 'personal')
      expect(workTag?.color).toBe('#FF0000')
      expect(personalTag?.color).toBeNull()
    })

    it('should return an empty tags array when no bindings exist', async () => {
      await seedAssistantRow({ id: 'ast-1', name: 'test' })

      const result = await assistantDataService.getById('ast-1')
      expect(result.tags).toEqual([])
    })

    it('should embed modelName resolved from user_model', async () => {
      await seedAssistantRow({ id: 'ast-1', name: 'test', modelId: 'anthropic::claude-3' })

      const result = await assistantDataService.getById('ast-1')
      expect(result.modelName).toBe('Claude 3')
    })

    it('should return null modelName when the assistant has no bound model', async () => {
      await seedAssistantRow({ id: 'ast-1', name: 'test' })

      const result = await assistantDataService.getById('ast-1')
      expect(result.modelName).toBeNull()
    })
  })

  describe('list', () => {
    it('should return all assistants with relation ids', async () => {
      await seedAssistantRow([
        { id: 'ast-1', name: 'first', modelId: 'openai::gpt-4', createdAt: 100 },
        { id: 'ast-2', name: 'second', modelId: 'anthropic::claude-3', createdAt: 200 }
      ])
      await seedMcpServer()
      await dbh.db.insert(assistantMcpServerTable).values({ assistantId: 'ast-2', mcpServerId: 'srv-1' })

      const result = await assistantDataService.list(listQuery())

      expect(result.items).toHaveLength(2)
      expect(result.total).toBe(2)
      expect(result.page).toBe(1)
      expect(result.items[0].id).toBe('ast-1')
      expect(result.items[1].mcpServerIds).toEqual(['srv-1'])
    })

    it('should exclude soft-deleted assistants', async () => {
      await seedAssistantRow([
        { id: 'ast-1', name: 'active' },
        { id: 'ast-2', name: 'deleted', deletedAt: Date.now() }
      ])

      const result = await assistantDataService.list(listQuery())
      expect(result.items).toHaveLength(1)
      expect(result.items[0].id).toBe('ast-1')
      expect(result.total).toBe(1)
    })

    it('should filter by id', async () => {
      await seedAssistantRow([
        { id: 'ast-1', name: 'first' },
        { id: 'ast-2', name: 'second' }
      ])

      const result = await assistantDataService.list(listQuery({ id: 'ast-2' }))
      expect(result.items).toHaveLength(1)
      expect(result.items[0].id).toBe('ast-2')
    })

    it('should filter by search on name (substring, case-insensitive)', async () => {
      await seedAssistantRow([
        { id: 'ast-1', name: 'Research Bot', description: 'finds papers' },
        { id: 'ast-2', name: 'coder', description: 'writes code' },
        { id: 'ast-3', name: 'Translator', description: 'translates text' }
      ])

      const result = await assistantDataService.list(listQuery({ search: 'RES' }))
      expect(result.items).toHaveLength(1)
      expect(result.items[0].id).toBe('ast-1')
      expect(result.total).toBe(1)
    })

    it('should filter by search matching the description', async () => {
      await seedAssistantRow([
        { id: 'ast-1', name: 'bot', description: 'answers email' },
        { id: 'ast-2', name: 'bot-two', description: 'files tickets' }
      ])

      const result = await assistantDataService.list(listQuery({ search: 'email' }))
      expect(result.items.map((a) => a.id)).toEqual(['ast-1'])
    })

    it('should treat %/_ in search as literals, not wildcards', async () => {
      await seedAssistantRow([
        { id: 'ast-1', name: 'percent_100', description: '' },
        { id: 'ast-2', name: 'noMatch', description: '' }
      ])

      const underscore = await assistantDataService.list(listQuery({ search: 'percent_' }))
      expect(underscore.items.map((a) => a.id)).toEqual(['ast-1'])

      // `_` should NOT match any single char — asking for a literal `_anything`
      // must miss an entity that contains `noMatch`.
      const literalMiss = await assistantDataService.list(listQuery({ search: '_Match' }))
      expect(literalMiss.items).toHaveLength(0)
    })

    it('should filter by tagIds with UNION semantics (ANY match)', async () => {
      await seedAssistantRow([
        { id: 'ast-1', name: 'work-only' },
        { id: 'ast-2', name: 'personal-only' },
        { id: 'ast-3', name: 'both' },
        { id: 'ast-4', name: 'untagged' }
      ])
      await dbh.db.insert(tagTable).values([
        { id: '11111111-1111-4111-8111-111111111111', name: 'work' },
        { id: '22222222-2222-4222-8222-222222222222', name: 'personal' }
      ])
      await dbh.db.insert(entityTagTable).values([
        { entityType: 'assistant', entityId: 'ast-1', tagId: '11111111-1111-4111-8111-111111111111' },
        { entityType: 'assistant', entityId: 'ast-2', tagId: '22222222-2222-4222-8222-222222222222' },
        { entityType: 'assistant', entityId: 'ast-3', tagId: '11111111-1111-4111-8111-111111111111' },
        { entityType: 'assistant', entityId: 'ast-3', tagId: '22222222-2222-4222-8222-222222222222' }
      ])

      const result = await assistantDataService.list(
        listQuery({
          tagIds: ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222']
        })
      )
      expect(result.items.map((a) => a.id).sort()).toEqual(['ast-1', 'ast-2', 'ast-3'])
      // union: the row count (total) must equal the distinct matching entity count,
      // not the sum of per-tag bindings (which would be 4 for ast-3 double-counted).
      expect(result.total).toBe(3)
    })

    it('should AND search with tagIds (tag-scoped keyword search)', async () => {
      await seedAssistantRow([
        { id: 'ast-1', name: 'Research Bot' },
        { id: 'ast-2', name: 'Research Cat' },
        { id: 'ast-3', name: 'unrelated' }
      ])
      await dbh.db.insert(tagTable).values({
        id: '11111111-1111-4111-8111-111111111111',
        name: 'work'
      })
      await dbh.db.insert(entityTagTable).values([
        { entityType: 'assistant', entityId: 'ast-1', tagId: '11111111-1111-4111-8111-111111111111' },
        { entityType: 'assistant', entityId: 'ast-3', tagId: '11111111-1111-4111-8111-111111111111' }
      ])

      const result = await assistantDataService.list(
        listQuery({
          search: 'Research',
          tagIds: ['11111111-1111-4111-8111-111111111111']
        })
      )
      // ast-2 matches search but not tag; ast-3 matches tag but not search.
      expect(result.items.map((a) => a.id)).toEqual(['ast-1'])
    })

    it('should respect page and limit parameters', async () => {
      await seedAssistantRow(
        Array.from({ length: 5 }, (_, i) => ({
          id: `ast-${i}`,
          name: `assistant-${i}`,
          createdAt: i * 100
        }))
      )

      const result = await assistantDataService.list(listQuery({ page: 2, limit: 2 }))
      expect(result.page).toBe(2)
      expect(result.total).toBe(5)
      expect(result.items).toHaveLength(2)
      expect(result.items[0].id).toBe('ast-2')
      expect(result.items[1].id).toBe('ast-3')
    })

    it('should order by createdAt ascending', async () => {
      await seedAssistantRow([
        { id: 'ast-new', name: 'new', createdAt: 300 },
        { id: 'ast-old', name: 'old', createdAt: 100 },
        { id: 'ast-mid', name: 'mid', createdAt: 200 }
      ])

      const result = await assistantDataService.list(listQuery())
      expect(result.items.map((a) => a.id)).toEqual(['ast-old', 'ast-mid', 'ast-new'])
    })

    it('should embed tags per assistant via inline JOIN', async () => {
      await seedAssistantRow([
        { id: 'ast-1', name: 'with-tags', createdAt: 100 },
        { id: 'ast-2', name: 'no-tags', createdAt: 200 }
      ])
      await dbh.db.insert(tagTable).values({
        id: '11111111-1111-4111-8111-111111111111',
        name: 'work',
        color: '#123456'
      })
      await dbh.db.insert(entityTagTable).values({
        entityType: 'assistant',
        entityId: 'ast-1',
        tagId: '11111111-1111-4111-8111-111111111111'
      })

      const result = await assistantDataService.list(listQuery())
      const byId = new Map(result.items.map((item) => [item.id, item]))

      expect(byId.get('ast-1')?.tags).toHaveLength(1)
      expect(byId.get('ast-1')?.tags[0].name).toBe('work')
      expect(byId.get('ast-2')?.tags).toEqual([])
    })

    it('should embed modelName via user_model JOIN', async () => {
      await seedAssistantRow([
        { id: 'ast-1', name: 'bound', modelId: 'openai::gpt-4', createdAt: 100 },
        { id: 'ast-2', name: 'unset', createdAt: 200 }
      ])

      const result = await assistantDataService.list(listQuery())
      const byId = new Map(result.items.map((item) => [item.id, item]))

      expect(byId.get('ast-1')?.modelName).toBe('GPT-4')
      // No model bound → null
      expect(byId.get('ast-2')?.modelName).toBeNull()
    })

    it('should order tags per assistant alphabetically', async () => {
      await seedAssistantRow({ id: 'ast-1', name: 'test' })
      // Insert in reverse alphabetical order + reverse createdAt, so an
      // order-by-createdAt implementation would give the opposite result.
      await dbh.db.insert(tagTable).values([
        { id: '33333333-3333-4333-8333-333333333333', name: 'zeta', createdAt: 100 },
        { id: '22222222-2222-4222-8222-222222222222', name: 'beta', createdAt: 200 },
        { id: '11111111-1111-4111-8111-111111111111', name: 'alpha', createdAt: 300 }
      ])
      await dbh.db.insert(entityTagTable).values([
        {
          entityType: 'assistant',
          entityId: 'ast-1',
          tagId: '33333333-3333-4333-8333-333333333333',
          createdAt: 100
        },
        {
          entityType: 'assistant',
          entityId: 'ast-1',
          tagId: '22222222-2222-4222-8222-222222222222',
          createdAt: 200
        },
        {
          entityType: 'assistant',
          entityId: 'ast-1',
          tagId: '11111111-1111-4111-8111-111111111111',
          createdAt: 300
        }
      ])

      const result = await assistantDataService.list(listQuery())
      expect(result.items[0].tags.map((t) => t.name)).toEqual(['alpha', 'beta', 'zeta'])
    })

    it('should embed tags and modelName for bulk lists (60 assistants)', async () => {
      const rowCount = 60
      const assistants = Array.from({ length: rowCount }, (_, i) => ({
        id: `ast-${String(i).padStart(3, '0')}`,
        name: `assistant-${i}`,
        // Alternate bound/unbound so both JOIN branches are exercised.
        modelId: i % 2 === 0 ? 'openai::gpt-4' : null,
        createdAt: i
      }))
      await seedAssistantRow(assistants)

      // One shared tag bound to a subset of assistants.
      await dbh.db.insert(tagTable).values({
        id: '11111111-1111-4111-8111-111111111111',
        name: 'bulk',
        color: null
      })
      await dbh.db.insert(entityTagTable).values(
        assistants
          .filter((_, i) => i % 3 === 0)
          .map((a) => ({
            entityType: 'assistant',
            entityId: a.id,
            tagId: '11111111-1111-4111-8111-111111111111'
          }))
      )

      const result = await assistantDataService.list(listQuery({ limit: rowCount }))

      expect(result.items).toHaveLength(rowCount)
      expect(result.total).toBe(rowCount)

      const boundModelCount = result.items.filter((it) => it.modelName === 'GPT-4').length
      expect(boundModelCount).toBe(rowCount / 2)

      const taggedCount = result.items.filter((it) => it.tags.length > 0).length
      expect(taggedCount).toBe(Math.ceil(rowCount / 3))
      // Every tagged item has the single bound tag — no duplicates / N+1 artifacts.
      for (const item of result.items) {
        if (item.tags.length > 0) expect(item.tags.map((t) => t.name)).toEqual(['bulk'])
      }
    })
  })

  describe('create', () => {
    it('should create and return assistant with generated id', async () => {
      const result = await assistantDataService.create({ name: 'test-assistant' })

      expect(result.id).toBeTruthy()
      expect(result.name).toBe('test-assistant')
      expect(result.modelId).toBeNull()
      expect(typeof result.createdAt).toBe('string')
    })

    it('should persist assistant to database', async () => {
      const created = await assistantDataService.create({ name: 'test-assistant' })

      const [row] = await dbh.db.select().from(assistantTable)
      expect(row.id).toBe(created.id)
      expect(row.name).toBe('test-assistant')
    })

    it('should apply default settings when settings are omitted', async () => {
      const created = await assistantDataService.create({ name: 'test-assistant' })

      expect(created.settings).toEqual(DEFAULT_ASSISTANT_SETTINGS)

      const [row] = await dbh.db.select().from(assistantTable)
      expect(row.settings).toEqual(DEFAULT_ASSISTANT_SETTINGS)
    })

    it("should apply '🌟' as the default emoji when omitted", async () => {
      const created = await assistantDataService.create({ name: 'test-assistant' })

      expect(created.emoji).toBe('🌟')

      const [row] = await dbh.db.select().from(assistantTable)
      expect(row.emoji).toBe('🌟')
    })

    it('should apply DB DEFAULT empty strings to prompt and description when omitted', async () => {
      const created = await assistantDataService.create({ name: 'test-assistant' })

      expect(created.prompt).toBe('')
      expect(created.description).toBe('')

      const [row] = await dbh.db.select().from(assistantTable)
      expect(row.prompt).toBe('')
      expect(row.description).toBe('')
    })

    it('should preserve client-supplied emoji over the service default', async () => {
      const created = await assistantDataService.create({ name: 'test-assistant', emoji: '🤖' })

      expect(created.emoji).toBe('🤖')

      const [row] = await dbh.db.select().from(assistantTable)
      expect(row.emoji).toBe('🤖')
    })

    it('should sync junction rows when relation ids are provided', async () => {
      await seedMcpServer()
      await seedKnowledgeBase()

      const result = await assistantDataService.create({
        name: 'test-assistant',
        modelId: 'openai::gpt-4',
        mcpServerIds: ['srv-1'],
        knowledgeBaseIds: ['kb-1']
      })

      expect(result.mcpServerIds).toEqual(['srv-1'])
      expect(result.knowledgeBaseIds).toEqual(['kb-1'])

      const mcpRows = await dbh.db.select().from(assistantMcpServerTable)
      const kbRows = await dbh.db.select().from(assistantKnowledgeBaseTable)
      expect(mcpRows).toHaveLength(1)
      expect(kbRows).toHaveLength(1)
      expect(mcpRows[0].assistantId).toBe(result.id)
    })

    it('should throw validation error when name is empty', async () => {
      await expect(assistantDataService.create({ name: '' })).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR
      })
    })

    it('should throw validation error when name is whitespace only', async () => {
      await expect(assistantDataService.create({ name: '   ' })).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR
      })
    })

    it('should bind tagIds inside the create transaction', async () => {
      await dbh.db.insert(tagTable).values([
        { id: '11111111-1111-4111-8111-111111111111', name: 'work', color: '#FF0000' },
        { id: '22222222-2222-4222-8222-222222222222', name: 'personal', color: null }
      ])

      const result = await assistantDataService.create({
        name: 'tagged',
        tagIds: ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222']
      })

      // Response embeds the freshly-written tags so the client avoids a refetch.
      expect(result.tags.map((t) => t.name).sort()).toEqual(['personal', 'work'])

      const bindings = await dbh.db.select().from(entityTagTable)
      expect(bindings).toHaveLength(2)
    })

    it('should roll the assistant row back when a referenced tag does not exist', async () => {
      await expect(
        assistantDataService.create({
          name: 'orphan',
          tagIds: ['99999999-9999-4999-8999-999999999999']
        })
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })

      // Transaction must leave no trace — assistant row rolled back with the binding.
      const rows = await dbh.db.select().from(assistantTable)
      expect(rows).toHaveLength(0)
    })

    it('should reject with VALIDATION_ERROR when modelId is not in user_model', async () => {
      // Covers the v2-llm-migration case: Redux may hand an unique id the user
      // never added to `user_model`. Service returns a clear field-scoped
      // validation error instead of leaking a raw `DrizzleQueryError` FK failure.
      await expect(
        assistantDataService.create({
          name: 'bad-model',
          modelId: 'cherryai::qwen'
        })
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        details: { fieldErrors: { modelId: expect.any(Array) } }
      })

      const rows = await dbh.db.select().from(assistantTable)
      expect(rows).toHaveLength(0)
    })

    it('should inject chat.default_model_id when the DTO omits modelId', async () => {
      MockMainPreferenceServiceUtils.setPreferenceValue('chat.default_model_id', createUniqueModelId('openai', 'gpt-4'))

      const result = await assistantDataService.create({ name: 'with-default' })

      expect(result.modelId).toBe('openai::gpt-4')
      expect(result.modelName).toBe('GPT-4')
    })

    it('should return modelName from the create transaction snapshot', async () => {
      const realTransaction = dbh.db.transaction.bind(dbh.db)
      const transactionSpy = vi.spyOn(dbh.db, 'transaction').mockImplementation(async (callback, config) => {
        const result = await realTransaction(callback, config)
        const { row } = result as { row: { id: string } }
        await dbh.db.update(assistantTable).set({ deletedAt: Date.now() }).where(eq(assistantTable.id, row.id))
        return result
      })

      try {
        const result = await assistantDataService.create({ name: 'with-model', modelId: 'openai::gpt-4' })

        expect(result.modelName).toBe('GPT-4')
      } finally {
        transactionSpy.mockRestore()
      }
    })

    it('should fall back to null when chat.default_model_id is stale', async () => {
      // Simulates a preference written before the referenced model was removed
      // from `user_model`. Creating must not reject; the assistant lands with
      // modelId=null and the service emits a logger.warn for diagnostics.
      MockMainPreferenceServiceUtils.setPreferenceValue('chat.default_model_id', 'ghost::missing-model')

      const result = await assistantDataService.create({ name: 'stale-pref' })

      expect(result.modelId).toBeNull()
      expect(result.modelName).toBeNull()
    })

    it('should not fall back to preference when caller passes modelId: null explicitly', async () => {
      MockMainPreferenceServiceUtils.setPreferenceValue('chat.default_model_id', createUniqueModelId('openai', 'gpt-4'))

      const result = await assistantDataService.create({ name: 'explicit-null', modelId: null })

      expect(result.modelId).toBeNull()
    })
  })

  describe('update', () => {
    it('should update and return assistant', async () => {
      await seedAssistantRow({ id: 'ast-1', name: 'original' })

      const result = await assistantDataService.update('ast-1', { name: 'updated-name' })
      expect(result.name).toBe('updated-name')
    })

    it('should persist update to database', async () => {
      await seedAssistantRow({ id: 'ast-1', name: 'original' })

      await assistantDataService.update('ast-1', { name: 'updated-name' })

      const [row] = await dbh.db.select().from(assistantTable)
      expect(row.name).toBe('updated-name')
    })

    it('should not pass relation fields to the column update', async () => {
      await seedAssistantRow({ id: 'ast-1', name: 'original' })
      await seedMcpServer()

      const result = await assistantDataService.update('ast-1', {
        name: 'updated',
        mcpServerIds: ['srv-1']
      })

      expect(result.name).toBe('updated')
      expect(result.mcpServerIds).toEqual(['srv-1'])

      const mcpRows = await dbh.db.select().from(assistantMcpServerTable)
      expect(mcpRows).toHaveLength(1)
    })

    it('should handle relation-only updates without modifying assistant columns', async () => {
      await seedAssistantRow({ id: 'ast-1', name: 'original', modelId: 'openai::gpt-4' })
      await seedMcpServer()
      await seedKnowledgeBase()

      const result = await assistantDataService.update('ast-1', {
        mcpServerIds: ['srv-1'],
        knowledgeBaseIds: ['kb-1']
      })

      expect(result.mcpServerIds).toEqual(['srv-1'])
      expect(result.knowledgeBaseIds).toEqual(['kb-1'])

      const [row] = await dbh.db.select().from(assistantTable)
      expect(row.name).toBe('original')
      expect(row.modelId).toBe('openai::gpt-4')
    })

    it('should preserve embedded tags after a column-only update', async () => {
      await seedAssistantRow({ id: 'ast-1', name: 'original' })
      await dbh.db.insert(tagTable).values({
        id: '11111111-1111-4111-8111-111111111111',
        name: 'work',
        color: null
      })
      await dbh.db.insert(entityTagTable).values({
        entityType: 'assistant',
        entityId: 'ast-1',
        tagId: '11111111-1111-4111-8111-111111111111'
      })

      const result = await assistantDataService.update('ast-1', { name: 'renamed' })

      expect(result.name).toBe('renamed')
      expect(result.tags.map((tag) => tag.name)).toEqual(['work'])
    })

    it('should re-resolve modelName when modelId changes', async () => {
      await seedAssistantRow({ id: 'ast-1', name: 'test', modelId: 'openai::gpt-4' })

      // Sanity: starts as "GPT-4"
      const before = await assistantDataService.getById('ast-1')
      expect(before.modelName).toBe('GPT-4')

      const result = await assistantDataService.update('ast-1', { modelId: 'anthropic::claude-3' })

      expect(result.modelId).toBe('anthropic::claude-3')
      expect(result.modelName).toBe('Claude 3')
    })

    it('should return changed modelName from the update transaction snapshot', async () => {
      await seedAssistantRow({ id: 'ast-1', name: 'test', modelId: 'openai::gpt-4' })
      const realTransaction = dbh.db.transaction.bind(dbh.db)
      const transactionSpy = vi.spyOn(dbh.db, 'transaction').mockImplementation(async (callback, config) => {
        const result = await realTransaction(callback, config)
        const { row } = result as { row: { id: string } }
        await dbh.db.update(assistantTable).set({ deletedAt: Date.now() }).where(eq(assistantTable.id, row.id))
        return result
      })

      try {
        const result = await assistantDataService.update('ast-1', { modelId: 'anthropic::claude-3' })

        expect(result.modelName).toBe('Claude 3')
      } finally {
        transactionSpy.mockRestore()
      }
    })

    it('should reuse modelName when modelId is unchanged', async () => {
      await seedAssistantRow({ id: 'ast-1', name: 'original', modelId: 'openai::gpt-4' })

      const result = await assistantDataService.update('ast-1', { name: 'renamed' })

      expect(result.name).toBe('renamed')
      expect(result.modelName).toBe('GPT-4')
    })

    it('should replace existing junction rows on relation update', async () => {
      await seedAssistantRow({ id: 'ast-1', name: 'test' })
      await seedMcpServer('srv-1', 'MCP1')
      await seedMcpServer('srv-2', 'MCP2')
      await dbh.db.insert(assistantMcpServerTable).values({ assistantId: 'ast-1', mcpServerId: 'srv-1' })

      await assistantDataService.update('ast-1', { mcpServerIds: ['srv-2'] })

      const mcpRows = await dbh.db.select().from(assistantMcpServerTable)
      expect(mcpRows).toHaveLength(1)
      expect(mcpRows[0].mcpServerId).toBe('srv-2')
    })

    it('should preserve junction createdAt for unchanged relations on PATCH', async () => {
      await seedAssistantRow({ id: 'ast-1', name: 'test' })
      await seedMcpServer('srv-1', 'MCP1')
      await seedMcpServer('srv-2', 'MCP2')
      await dbh.db
        .insert(assistantMcpServerTable)
        .values({ assistantId: 'ast-1', mcpServerId: 'srv-1', createdAt: 1000 })

      await assistantDataService.update('ast-1', { mcpServerIds: ['srv-1', 'srv-2'] })

      const mcpRows = await dbh.db.select().from(assistantMcpServerTable)
      expect(mcpRows).toHaveLength(2)
      const srv1Row = mcpRows.find((r) => r.mcpServerId === 'srv-1')
      expect(srv1Row?.createdAt).toBe(1000)
    })

    it('should throw NOT_FOUND when updating non-existent assistant', async () => {
      await expect(assistantDataService.update('non-existent', { name: 'x' })).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })

    it('should throw validation error when name is set to empty', async () => {
      await seedAssistantRow({ id: 'ast-1', name: 'original' })

      await expect(assistantDataService.update('ast-1', { name: '' })).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR
      })
    })

    it('should diff-sync tagIds on update (adds new, removes missing)', async () => {
      await seedAssistantRow({ id: 'ast-1', name: 'test' })
      await dbh.db.insert(tagTable).values([
        { id: '11111111-1111-4111-8111-111111111111', name: 'work' },
        { id: '22222222-2222-4222-8222-222222222222', name: 'personal' },
        { id: '33333333-3333-4333-8333-333333333333', name: 'priority' }
      ])
      await dbh.db.insert(entityTagTable).values([
        { entityType: 'assistant', entityId: 'ast-1', tagId: '11111111-1111-4111-8111-111111111111' },
        { entityType: 'assistant', entityId: 'ast-1', tagId: '22222222-2222-4222-8222-222222222222' }
      ])

      const result = await assistantDataService.update('ast-1', {
        tagIds: ['22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333']
      })

      expect(result.tags.map((t) => t.name).sort()).toEqual(['personal', 'priority'])
      const rows = await dbh.db.select().from(entityTagTable).where(eq(entityTagTable.entityId, 'ast-1'))
      expect(rows.map((r) => r.tagId).sort()).toEqual([
        '22222222-2222-4222-8222-222222222222',
        '33333333-3333-4333-8333-333333333333'
      ])
    })

    it('should clear all tag bindings when tagIds is an empty array', async () => {
      await seedAssistantRow({ id: 'ast-1', name: 'test' })
      await dbh.db.insert(tagTable).values({ id: '11111111-1111-4111-8111-111111111111', name: 'work' })
      await dbh.db.insert(entityTagTable).values({
        entityType: 'assistant',
        entityId: 'ast-1',
        tagId: '11111111-1111-4111-8111-111111111111'
      })

      const result = await assistantDataService.update('ast-1', { tagIds: [] })

      expect(result.tags).toEqual([])
      const rows = await dbh.db.select().from(entityTagTable)
      expect(rows).toHaveLength(0)
    })

    it('should leave tag bindings untouched when tagIds is undefined', async () => {
      await seedAssistantRow({ id: 'ast-1', name: 'original' })
      await dbh.db.insert(tagTable).values({ id: '11111111-1111-4111-8111-111111111111', name: 'work' })
      await dbh.db.insert(entityTagTable).values({
        entityType: 'assistant',
        entityId: 'ast-1',
        tagId: '11111111-1111-4111-8111-111111111111'
      })

      await assistantDataService.update('ast-1', { name: 'renamed' })

      const rows = await dbh.db.select().from(entityTagTable)
      expect(rows).toHaveLength(1)
    })

    it('should roll the column update back when a referenced tag does not exist', async () => {
      await seedAssistantRow({ id: 'ast-1', name: 'original' })

      await expect(
        assistantDataService.update('ast-1', {
          name: 'renamed',
          tagIds: ['99999999-9999-4999-8999-999999999999']
        })
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })

      // Column write must be inside the same tx as the binding sync.
      const [row] = await dbh.db.select().from(assistantTable)
      expect(row.name).toBe('original')
    })

    it('should atomically roll all junction writes back when any one fails', async () => {
      // Covers the full fan-out: column update + mcpServer sync + tag sync in
      // one tx. A bad tagId at the end must not leave partial mcp bindings.
      await seedAssistantRow({ id: 'ast-1', name: 'before' })
      await seedMcpServer('srv-1')

      await expect(
        assistantDataService.update('ast-1', {
          name: 'after',
          mcpServerIds: ['srv-1'],
          tagIds: ['99999999-9999-4999-8999-999999999999']
        })
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })

      const [row] = await dbh.db.select().from(assistantTable)
      expect(row.name).toBe('before')
      const mcpRows = await dbh.db.select().from(assistantMcpServerTable)
      expect(mcpRows).toHaveLength(0)
    })

    it('should throw NOT_FOUND without clobbering when soft-deleted concurrently', async () => {
      // Simulates the TOCTOU race: getById passes, another window soft-deletes
      // the row, then the tx runs. The liveness guard inside the tx must turn
      // what would otherwise be a silent "update a deleted row" into NOT_FOUND,
      // rolling back both column + junction writes.
      await seedAssistantRow({ id: 'ast-1', name: 'before' })
      await seedMcpServer('srv-1')
      await dbh.db.insert(tagTable).values({
        id: '11111111-1111-4111-8111-111111111111',
        name: 'work'
      })

      const originalGetById = assistantDataService.getById.bind(assistantDataService)
      const getByIdSpy = vi.spyOn(assistantDataService, 'getById').mockImplementation(async (id: string, options) => {
        const result = await originalGetById(id, options)
        // Between the entry-level getById and the tx, simulate a concurrent
        // DELETE /assistants/:id from another window.
        await dbh.db.update(assistantTable).set({ deletedAt: Date.now() }).where(eq(assistantTable.id, id))
        return result
      })

      try {
        await expect(
          assistantDataService.update('ast-1', {
            name: 'after',
            mcpServerIds: ['srv-1'],
            tagIds: ['11111111-1111-4111-8111-111111111111']
          })
        ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })
      } finally {
        getByIdSpy.mockRestore()
      }

      // Row stays soft-deleted with its original name; no junction rows landed.
      const [row] = await dbh.db.select().from(assistantTable)
      expect(row.name).toBe('before')
      expect(row.deletedAt).not.toBeNull()
      const mcpRows = await dbh.db.select().from(assistantMcpServerTable)
      expect(mcpRows).toHaveLength(0)
      const tagRows = await dbh.db.select().from(entityTagTable)
      expect(tagRows).toHaveLength(0)
    })

    it('should reject with VALIDATION_ERROR when update modelId is not in user_model', async () => {
      await seedAssistantRow({ id: 'ast-1', name: 'before' })

      await expect(assistantDataService.update('ast-1', { modelId: 'cherryai::qwen' })).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        details: { fieldErrors: { modelId: expect.any(Array) } }
      })

      // Row name stays unchanged — modelId validation runs before the column write.
      const [row] = await dbh.db.select().from(assistantTable)
      expect(row.name).toBe('before')
      expect(row.modelId).toBeNull()
    })

    it('should throw NOT_FOUND on relation-only update when soft-deleted concurrently', async () => {
      // Relation-only edit has no column UPDATE, so the liveness guard must
      // come from the explicit SELECT inside the tx.
      await seedAssistantRow({ id: 'ast-1', name: 'before' })
      await seedMcpServer('srv-1')

      const originalGetById = assistantDataService.getById.bind(assistantDataService)
      const getByIdSpy = vi.spyOn(assistantDataService, 'getById').mockImplementation(async (id: string, options) => {
        const result = await originalGetById(id, options)
        await dbh.db.update(assistantTable).set({ deletedAt: Date.now() }).where(eq(assistantTable.id, id))
        return result
      })

      try {
        await expect(assistantDataService.update('ast-1', { mcpServerIds: ['srv-1'] })).rejects.toMatchObject({
          code: ErrorCode.NOT_FOUND
        })
      } finally {
        getByIdSpy.mockRestore()
      }

      const mcpRows = await dbh.db.select().from(assistantMcpServerTable)
      expect(mcpRows).toHaveLength(0)
    })
  })

  describe('delete', () => {
    it('should soft-delete by setting deletedAt timestamp', async () => {
      await seedAssistantRow({ id: 'ast-1', name: 'test' })

      await assistantDataService.delete('ast-1')

      const [row] = await dbh.db.select().from(assistantTable)
      expect(row.deletedAt).toBeTruthy()
      expect(typeof row.deletedAt).toBe('number')
    })

    it('should not physically remove the row', async () => {
      await seedAssistantRow({ id: 'ast-1', name: 'test' })

      await assistantDataService.delete('ast-1')

      const rows = await dbh.db.select().from(assistantTable)
      expect(rows).toHaveLength(1)
    })

    it('should remove entity_tag rows for the deleted assistant', async () => {
      await seedAssistantRow({ id: 'ast-1', name: 'test' })
      await dbh.db.insert(tagTable).values({ id: 'tag-1', name: 'work' })
      await dbh.db.insert(entityTagTable).values({ entityType: 'assistant', entityId: 'ast-1', tagId: 'tag-1' })

      await assistantDataService.delete('ast-1')

      const tagRows = await dbh.db.select().from(entityTagTable)
      expect(tagRows).toHaveLength(0)
    })

    it('should remove pin rows for the deleted assistant', async () => {
      await seedAssistantRow({ id: 'ast-1', name: 'test' })
      await dbh.db.insert(pinTable).values({
        id: '11111111-1111-4111-8111-111111111111',
        entityType: 'assistant',
        entityId: 'ast-1',
        orderKey: 'a0',
        createdAt: 1_000,
        updatedAt: 1_000
      })

      await assistantDataService.delete('ast-1')

      const pinRows = await dbh.db.select().from(pinTable)
      expect(pinRows).toHaveLength(0)
    })

    it('should throw NOT_FOUND when deleting non-existent assistant', async () => {
      await expect(assistantDataService.delete('non-existent')).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })

    it('should throw NOT_FOUND when deleting already-deleted assistant', async () => {
      await seedAssistantRow({ id: 'ast-1', name: 'test', deletedAt: Date.now() })

      await expect(assistantDataService.delete('ast-1')).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })
  })

  describe('db constraints', () => {
    it('should cascade-delete junction rows when assistant is physically deleted', async () => {
      await seedAssistantRow({ id: 'ast-1', name: 'test' })
      await seedMcpServer()
      await dbh.db.insert(assistantMcpServerTable).values({ assistantId: 'ast-1', mcpServerId: 'srv-1' })

      await dbh.client.execute({ sql: 'DELETE FROM assistant WHERE id = ?', args: ['ast-1'] })

      const mcpRows = await dbh.db.select().from(assistantMcpServerTable)
      expect(mcpRows).toHaveLength(0)
    })

    it('should cascade-delete junction rows when mcp_server is deleted', async () => {
      await seedAssistantRow({ id: 'ast-1', name: 'test' })
      await seedMcpServer()
      await dbh.db.insert(assistantMcpServerTable).values({ assistantId: 'ast-1', mcpServerId: 'srv-1' })

      await dbh.client.execute({ sql: 'DELETE FROM mcp_server WHERE id = ?', args: ['srv-1'] })

      const mcpRows = await dbh.db.select().from(assistantMcpServerTable)
      expect(mcpRows).toHaveLength(0)
    })

    it('should reject duplicate junction rows', async () => {
      await seedAssistantRow({ id: 'ast-1', name: 'test' })
      await seedMcpServer()
      await dbh.db.insert(assistantMcpServerTable).values({ assistantId: 'ast-1', mcpServerId: 'srv-1' })

      await expect(
        dbh.db.insert(assistantMcpServerTable).values({ assistantId: 'ast-1', mcpServerId: 'srv-1' })
      ).rejects.toThrow()
    })
  })
})
