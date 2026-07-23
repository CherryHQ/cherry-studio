// Load the sibling so TopicService can purge topic messages through the data-service registry.
import '@data/services/MessageService'

import { assistantTable } from '@data/db/schemas/assistant'
import { assistantKnowledgeBaseTable, assistantMcpServerTable } from '@data/db/schemas/assistantRelations'
import { groupTable } from '@data/db/schemas/group'
import { knowledgeBaseTable } from '@data/db/schemas/knowledge'
import { mcpServerTable } from '@data/db/schemas/mcpServer'
import { pinTable } from '@data/db/schemas/pin'
import { topicTable } from '@data/db/schemas/topic'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { AssistantDataService, assistantDataService } from '@data/services/AssistantService'
import { pinService } from '@data/services/PinService'
import { topicService } from '@data/services/TopicService'
import { generateOrderKeySequence } from '@data/services/utils/orderKey'
import { ErrorCode } from '@shared/data/api/errors'
import { type ListAssistantsQuery, ListAssistantsQuerySchema } from '@shared/data/api/schemas/assistants'
import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'
import { createUniqueModelId } from '@shared/data/types/model'
import { setupTestDatabase } from '@test-helpers/db'
import { MockMainDbServiceExport } from '@test-mocks/main/DbService'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { asc, eq } from 'drizzle-orm'
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
    MockMainDbServiceExport.dbService.withWriteTx.mockImplementation((fn) => dbh.db.transaction(fn as never))
    await seedModelRefs()
  })

  async function seedModelRefs() {
    const [openaiKey, anthropicKey, gpt4Key, claude3Key, embeddingKey] = generateOrderKeySequence(5)
    await dbh.db.insert(userProviderTable).values([
      { providerId: 'openai', name: 'OpenAI', orderKey: openaiKey },
      { providerId: 'anthropic', name: 'Anthropic', orderKey: anthropicKey }
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
        orderKey: gpt4Key
      },
      {
        id: createUniqueModelId('anthropic', 'claude-3'),
        providerId: 'anthropic',
        modelId: 'claude-3',
        presetModelId: 'claude-3',
        name: 'Claude 3',
        isEnabled: true,
        isHidden: false,
        orderKey: claude3Key
      },
      {
        id: createUniqueModelId('openai', 'text-embedding-3-large'),
        providerId: 'openai',
        modelId: 'text-embedding-3-large',
        presetModelId: 'text-embedding-3-large',
        name: 'text-embedding-3-large',
        isEnabled: true,
        isHidden: false,
        orderKey: embeddingKey
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
      dimensions: 1024,
      embeddingModelId: createUniqueModelId('openai', 'text-embedding-3-large'),
      status: 'completed',
      error: null,
      chunkSize: 1024,
      chunkOverlap: 200
    })
  }

  async function seedAssistantGroup(id: string, name = 'Group', orderKey = 'a0') {
    await dbh.db.insert(groupTable).values({ id, entityType: 'assistant', name, orderKey })
  }

  // Raw-insert helper that fills the NOT-NULL columns the DB has no DEFAULT for
  // (emoji / settings / orderKey). Tests that exercise read-path semantics on
  // hand-crafted rows go through this helper so they don't need to repeat
  // boilerplate every call site. `orderKey` defaults to 'a0' since most tests
  // don't care about ordering; tests that assert ordering should pass explicit keys.
  type SeedAssistantValues = Partial<typeof assistantTable.$inferInsert>
  async function seedAssistantRow(values: SeedAssistantValues | SeedAssistantValues[]) {
    const rows = Array.isArray(values) ? values : [values]
    const orderKeys = generateOrderKeySequence(rows.length)
    await dbh.db.insert(assistantTable).values(
      rows.map((v, index) => ({
        emoji: '🌟',
        settings: DEFAULT_ASSISTANT_SETTINGS,
        name: 'test',
        orderKey: orderKeys[index],
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

      const result = assistantDataService.getById('ast-1')

      expect(result.id).toBe('ast-1')
      expect(result.name).toBe('test')
      expect(result.modelId).toBe('openai::gpt-4')
      expect(result.mcpServerIds).toEqual(['srv-1'])
      expect(result.knowledgeBaseIds).toEqual(['kb-1'])
      expect(typeof result.createdAt).toBe('string')
    })

    it('should return null modelId when not set', async () => {
      await seedAssistantRow({ id: 'ast-1', name: 'test' })

      const result = assistantDataService.getById('ast-1')
      expect(result.modelId).toBeNull()
    })

    it('should surface DB DEFAULT empty strings for prompt and description', async () => {
      // emoji and settings are NOT NULL with no DB DEFAULT, so the helper supplies them.
      // prompt and description carry DB DEFAULT '' — confirm SQLite fills them when omitted.
      await seedAssistantRow({ id: 'ast-1', name: 'test' })

      const result = assistantDataService.getById('ast-1')
      expect(result.prompt).toBe('')
      expect(result.description).toBe('')
      expect(result.mcpServerIds).toEqual([])
      expect(result.knowledgeBaseIds).toEqual([])
    })

    it('should return soft-deleted assistant when includeDeleted is true', async () => {
      await seedAssistantRow({ id: 'ast-1', name: 'test' })
      await dbh.db.update(assistantTable).set({ deletedAt: Date.now() })

      const result = assistantDataService.getById('ast-1', { includeDeleted: true })
      expect(result.id).toBe('ast-1')
    })

    it('should NOT return soft-deleted assistant by default', async () => {
      await seedAssistantRow({ id: 'ast-1', name: 'test' })
      await dbh.db.update(assistantTable).set({ deletedAt: Date.now() })

      let err: unknown
      try {
        assistantDataService.getById('ast-1')
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })

    it('should throw NOT_FOUND when assistant does not exist', async () => {
      let err: unknown
      try {
        assistantDataService.getById('non-existent')
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })

    it('should return the assistant group id', async () => {
      const groupId = '11111111-1111-4111-8111-111111111111'
      await seedAssistantGroup(groupId, 'work')
      await seedAssistantRow({ id: 'ast-1', name: 'test', groupId })

      const result = assistantDataService.getById('ast-1')
      expect(result.groupId).toBe(groupId)
    })

    it('should return null when no group is assigned', async () => {
      await seedAssistantRow({ id: 'ast-1', name: 'test' })

      const result = assistantDataService.getById('ast-1')
      expect(result.groupId).toBeNull()
    })

    it('should embed modelName resolved from user_model', async () => {
      await seedAssistantRow({ id: 'ast-1', name: 'test', modelId: 'anthropic::claude-3' })

      const result = assistantDataService.getById('ast-1')
      expect(result.modelName).toBe('Claude 3')
    })

    it('should return null modelName when the assistant has no bound model', async () => {
      await seedAssistantRow({ id: 'ast-1', name: 'test' })

      const result = assistantDataService.getById('ast-1')
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

      const result = assistantDataService.list(listQuery())

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

      const result = assistantDataService.list(listQuery())
      expect(result.items).toHaveLength(1)
      expect(result.items[0].id).toBe('ast-1')
      expect(result.total).toBe(1)
    })

    it('should filter by id', async () => {
      await seedAssistantRow([
        { id: 'ast-1', name: 'first' },
        { id: 'ast-2', name: 'second' }
      ])

      const result = assistantDataService.list(listQuery({ id: 'ast-2' }))
      expect(result.items).toHaveLength(1)
      expect(result.items[0].id).toBe('ast-2')
    })

    it('should filter by search on name (substring, case-insensitive)', async () => {
      await seedAssistantRow([
        { id: 'ast-1', name: 'Research Bot', description: 'finds papers' },
        { id: 'ast-2', name: 'coder', description: 'writes code' },
        { id: 'ast-3', name: 'Translator', description: 'translates text' }
      ])

      const result = assistantDataService.list(listQuery({ search: 'RES' }))
      expect(result.items).toHaveLength(1)
      expect(result.items[0].id).toBe('ast-1')
      expect(result.total).toBe(1)
    })

    it('should filter by search matching the description', async () => {
      await seedAssistantRow([
        { id: 'ast-1', name: 'bot', description: 'answers email' },
        { id: 'ast-2', name: 'bot-two', description: 'files tickets' }
      ])

      const result = assistantDataService.list(listQuery({ search: 'email' }))
      expect(result.items.map((a) => a.id)).toEqual(['ast-1'])
    })

    it('filters by updatedAtFrom and can sort by updatedAt descending', async () => {
      const cutoffIso = '2026-05-01T00:00:00.000Z'
      const cutoff = Date.parse(cutoffIso)
      await seedAssistantRow([
        { id: 'ast-old', name: 'Research old', updatedAt: cutoff - 1, orderKey: 'a0' },
        { id: 'ast-newer', name: 'Research newer', updatedAt: cutoff + 2000, orderKey: 'a1' },
        { id: 'ast-newest', name: 'Research newest', updatedAt: cutoff + 3000, orderKey: 'a2' },
        { id: 'ast-other', name: 'Other', updatedAt: cutoff + 4000, orderKey: 'a3' }
      ])

      const result = assistantDataService.list({
        ...listQuery({ search: 'Research', limit: 10 }),
        updatedAtFrom: cutoffIso,
        sortBy: 'updatedAt',
        sortOrder: 'desc'
      })

      expect(result.items.map((a) => a.id)).toEqual(['ast-newest', 'ast-newer'])
      expect(result.total).toBe(2)
    })

    it('should treat %/_ in search as literals, not wildcards', async () => {
      await seedAssistantRow([
        { id: 'ast-1', name: 'percent_100', description: '' },
        { id: 'ast-2', name: 'noMatch', description: '' }
      ])

      const underscore = assistantDataService.list(listQuery({ search: 'percent_' }))
      expect(underscore.items.map((a) => a.id)).toEqual(['ast-1'])

      // `_` should NOT match any single char — asking for a literal `_anything`
      // must miss an entity that contains `noMatch`.
      const literalMiss = assistantDataService.list(listQuery({ search: '_Match' }))
      expect(literalMiss.items).toHaveLength(0)
    })

    it('should filter by one exact groupId', async () => {
      const workGroupId = '11111111-1111-4111-8111-111111111111'
      const personalGroupId = '22222222-2222-4222-8222-222222222222'
      await seedAssistantGroup(workGroupId, 'work', 'a0')
      await seedAssistantGroup(personalGroupId, 'personal', 'a1')
      await seedAssistantRow([
        { id: 'ast-1', name: 'work-one', groupId: workGroupId },
        { id: 'ast-2', name: 'personal', groupId: personalGroupId },
        { id: 'ast-3', name: 'work-two', groupId: workGroupId },
        { id: 'ast-4', name: 'ungrouped' }
      ])

      const result = assistantDataService.list(listQuery({ groupId: workGroupId }))
      expect(result.items.map((assistant) => assistant.id)).toEqual(['ast-1', 'ast-3'])
      expect(result.total).toBe(2)
    })

    it('should AND search with groupId', async () => {
      const groupId = '11111111-1111-4111-8111-111111111111'
      await seedAssistantGroup(groupId, 'work')
      await seedAssistantRow([
        { id: 'ast-1', name: 'Research Bot', groupId },
        { id: 'ast-2', name: 'Research Cat' },
        { id: 'ast-3', name: 'unrelated', groupId }
      ])

      const result = assistantDataService.list(
        listQuery({
          search: 'Research',
          groupId
        })
      )
      // ast-2 matches search but not group; ast-3 matches group but not search.
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

      const result = assistantDataService.list(listQuery({ page: 2, limit: 2 }))
      expect(result.page).toBe(2)
      expect(result.total).toBe(5)
      expect(result.items).toHaveLength(2)
      expect(result.items[0].id).toBe('ast-2')
      expect(result.items[1].id).toBe('ast-3')
    })

    it('should order by orderKey ascending with createdAt tiebreaker', async () => {
      await seedAssistantRow([
        { id: 'ast-later-created', name: 'first-by-key', orderKey: 'a0', createdAt: 300 },
        { id: 'ast-a', name: 'tie-a', orderKey: 'a1', createdAt: 100 },
        { id: 'ast-b', name: 'tie-b', orderKey: 'a1', createdAt: 200 },
        { id: 'ast-earlier-created', name: 'last-by-key', orderKey: 'a2', createdAt: 50 }
      ])

      const result = assistantDataService.list(listQuery())
      expect(result.items.map((a) => a.id)).toEqual(['ast-later-created', 'ast-a', 'ast-b', 'ast-earlier-created'])
    })

    it('does not float pinned assistants when sorting by updatedAt', async () => {
      await seedAssistantRow([
        { id: 'ast-old-pinned', name: 'old pinned', updatedAt: 100, orderKey: 'a0' },
        { id: 'ast-mid', name: 'mid', updatedAt: 200, orderKey: 'a1' },
        { id: 'ast-new', name: 'new', updatedAt: 300, orderKey: 'a2' }
      ])
      pinService.pin({ entityType: 'assistant', entityId: 'ast-old-pinned' })

      const result = assistantDataService.list(listQuery({ sortBy: 'updatedAt', sortOrder: 'desc' }))
      expect(result.items.map((a) => a.id)).toEqual(['ast-new', 'ast-mid', 'ast-old-pinned'])
    })

    it('surfaces pinned assistants ahead of unpinned ones, sorted by pin.orderKey', async () => {
      await seedAssistantRow([
        { id: 'ast-1', name: 'a1', createdAt: 100 },
        { id: 'ast-2', name: 'a2', createdAt: 200 },
        { id: 'ast-3', name: 'a3', createdAt: 300 },
        { id: 'ast-4', name: 'a4', createdAt: 400 }
      ])
      // Pin ast-3 then ast-1 — pin.orderKey is assigned by `insertWithOrderKey`,
      // so the second pin gets a larger key and appears AFTER ast-3 in the
      // pinned section.
      pinService.pin({ entityType: 'assistant', entityId: 'ast-3' })
      pinService.pin({ entityType: 'assistant', entityId: 'ast-1' })

      const result = assistantDataService.list(listQuery())
      expect(result.items.map((a) => a.id)).toEqual(['ast-3', 'ast-1', 'ast-2', 'ast-4'])
    })

    it('keeps unpinned assistants in createdAt order when no pins exist', async () => {
      // Regression: the pin LEFT JOIN must not change ordering for the
      // pin-free path. Pin column is NULL for every row → CASE evaluates to 1
      // uniformly → secondary sort applies as before.
      await seedAssistantRow([
        { id: 'ast-z', name: 'z', orderKey: 'a0', createdAt: 300 },
        { id: 'ast-a', name: 'a', orderKey: 'a0', createdAt: 100 },
        { id: 'ast-m', name: 'm', orderKey: 'a0', createdAt: 200 }
      ])

      const result = assistantDataService.list(listQuery())
      expect(result.items.map((a) => a.id)).toEqual(['ast-a', 'ast-m', 'ast-z'])
    })

    it('should return group ids per assistant', async () => {
      const groupId = '11111111-1111-4111-8111-111111111111'
      await seedAssistantGroup(groupId, 'work')
      await seedAssistantRow([
        { id: 'ast-1', name: 'grouped', groupId, createdAt: 100 },
        { id: 'ast-2', name: 'ungrouped', createdAt: 200 }
      ])

      const result = assistantDataService.list(listQuery())
      const byId = new Map(result.items.map((item) => [item.id, item]))

      expect(byId.get('ast-1')?.groupId).toBe(groupId)
      expect(byId.get('ast-2')?.groupId).toBeNull()
    })

    it('should embed modelName via user_model JOIN', async () => {
      await seedAssistantRow([
        { id: 'ast-1', name: 'bound', modelId: 'openai::gpt-4', createdAt: 100 },
        { id: 'ast-2', name: 'unset', createdAt: 200 }
      ])

      const result = assistantDataService.list(listQuery())
      const byId = new Map(result.items.map((item) => [item.id, item]))

      expect(byId.get('ast-1')?.modelName).toBe('GPT-4')
      // No model bound → null
      expect(byId.get('ast-2')?.modelName).toBeNull()
    })

    it('should return groupId and modelName for bulk lists (60 assistants)', async () => {
      const rowCount = 60
      const groupId = '11111111-1111-4111-8111-111111111111'
      await seedAssistantGroup(groupId, 'bulk')
      const assistants = Array.from({ length: rowCount }, (_, i) => ({
        id: `ast-${String(i).padStart(3, '0')}`,
        name: `assistant-${i}`,
        // Alternate bound/unbound so both JOIN branches are exercised.
        modelId: i % 2 === 0 ? 'openai::gpt-4' : null,
        groupId: i % 3 === 0 ? groupId : null,
        createdAt: i
      }))
      await seedAssistantRow(assistants)

      const result = assistantDataService.list(listQuery({ limit: rowCount }))

      expect(result.items).toHaveLength(rowCount)
      expect(result.total).toBe(rowCount)

      const boundModelCount = result.items.filter((it) => it.modelName === 'GPT-4').length
      expect(boundModelCount).toBe(rowCount / 2)

      const groupedCount = result.items.filter((item) => item.groupId === groupId).length
      expect(groupedCount).toBe(Math.ceil(rowCount / 3))
    })
  })

  describe('create', () => {
    it('should create and return assistant with generated id', async () => {
      const result = assistantDataService.create({ name: 'test-assistant' })

      expect(result.id).toBeTruthy()
      expect(result.name).toBe('test-assistant')
      expect(result.modelId).toBeNull()
      expect(result.orderKey.length).toBeGreaterThan(0)
      expect(typeof result.createdAt).toBe('string')
    })

    it('should assign strictly increasing order keys on successive creates', async () => {
      const first = assistantDataService.create({ name: 'first' })
      const second = assistantDataService.create({ name: 'second' })
      const third = assistantDataService.create({ name: 'third' })

      const rows = await dbh.db
        .select({ id: assistantTable.id, orderKey: assistantTable.orderKey })
        .from(assistantTable)
        .orderBy(asc(assistantTable.orderKey), asc(assistantTable.id))

      expect(rows.map((row) => row.id)).toEqual([first.id, second.id, third.id])
      expect(first.orderKey < second.orderKey).toBe(true)
      expect(second.orderKey < third.orderKey).toBe(true)
    })

    it('should persist assistant to database', async () => {
      const created = assistantDataService.create({ name: 'test-assistant' })

      const [row] = await dbh.db.select().from(assistantTable)
      expect(row.id).toBe(created.id)
      expect(row.name).toBe('test-assistant')
    })

    it('should apply default settings when settings are omitted', async () => {
      const created = assistantDataService.create({ name: 'test-assistant' })

      expect(created.settings).toEqual(DEFAULT_ASSISTANT_SETTINGS)

      const [row] = await dbh.db.select().from(assistantTable)
      expect(row.settings).toEqual(DEFAULT_ASSISTANT_SETTINGS)
    })

    it("should apply '🌟' as the default emoji when omitted", async () => {
      const created = assistantDataService.create({ name: 'test-assistant' })

      expect(created.emoji).toBe('🌟')

      const [row] = await dbh.db.select().from(assistantTable)
      expect(row.emoji).toBe('🌟')
    })

    it('should apply DB DEFAULT empty strings to prompt and description when omitted', async () => {
      const created = assistantDataService.create({ name: 'test-assistant' })

      expect(created.prompt).toBe('')
      expect(created.description).toBe('')

      const [row] = await dbh.db.select().from(assistantTable)
      expect(row.prompt).toBe('')
      expect(row.description).toBe('')
    })

    it('should preserve client-supplied emoji over the service default', async () => {
      const created = assistantDataService.create({ name: 'test-assistant', emoji: '🤖' })

      expect(created.emoji).toBe('🤖')

      const [row] = await dbh.db.select().from(assistantTable)
      expect(row.emoji).toBe('🤖')
    })

    it('should sync junction rows when relation ids are provided', async () => {
      await seedMcpServer()
      await seedKnowledgeBase()

      const result = assistantDataService.create({
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
      let err: unknown
      try {
        assistantDataService.create({ name: '' })
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({
        code: ErrorCode.VALIDATION_ERROR
      })
    })

    it('should throw validation error when name is whitespace only', async () => {
      let err: unknown
      try {
        assistantDataService.create({ name: '   ' })
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({
        code: ErrorCode.VALIDATION_ERROR
      })
    })

    it('should persist groupId when creating an assistant', async () => {
      const groupId = '11111111-1111-4111-8111-111111111111'
      await seedAssistantGroup(groupId, 'work')

      const result = assistantDataService.create({
        name: 'grouped',
        groupId
      })

      expect(result.groupId).toBe(groupId)
      const [row] = await dbh.db.select().from(assistantTable)
      expect(row.groupId).toBe(groupId)
    })

    it('should reject a missing assistant group with a field-scoped validation error', async () => {
      const groupId = '99999999-9999-4999-8999-999999999999'
      let err: unknown

      try {
        assistantDataService.create({ name: 'grouped', groupId })
      } catch (error) {
        err = error
      }

      expect(err).toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        details: { fieldErrors: { groupId: expect.any(Array) } }
      })
      expect(await dbh.db.select().from(assistantTable)).toHaveLength(0)
    })

    it('should reject a group owned by another entity type', async () => {
      const groupId = '11111111-1111-4111-8111-111111111111'
      await dbh.db.insert(groupTable).values({ id: groupId, entityType: 'topic', name: 'topics', orderKey: 'a0' })
      let err: unknown

      try {
        assistantDataService.create({ name: 'grouped', groupId })
      } catch (error) {
        err = error
      }

      expect(err).toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        details: { fieldErrors: { groupId: expect.any(Array) } }
      })
      expect(await dbh.db.select().from(assistantTable)).toHaveLength(0)
    })

    it('should reject with VALIDATION_ERROR when modelId is not in user_model', async () => {
      // Covers the v2-llm-migration case: Redux may hand an unique id the user
      // never added to `user_model`. Service returns a clear field-scoped
      // validation error instead of leaking a raw `DrizzleQueryError` FK failure.
      let err: unknown
      try {
        assistantDataService.create({
          name: 'bad-model',
          modelId: 'cherryai::qwen'
        })
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        details: { fieldErrors: { modelId: expect.any(Array) } }
      })

      const rows = await dbh.db.select().from(assistantTable)
      expect(rows).toHaveLength(0)
    })

    it('should inject chat.default_model_id when the DTO omits modelId', async () => {
      MockMainPreferenceServiceUtils.setPreferenceValue('chat.default_model_id', createUniqueModelId('openai', 'gpt-4'))

      const result = assistantDataService.create({ name: 'with-default' })

      expect(result.modelId).toBe('openai::gpt-4')
      expect(result.modelName).toBe('GPT-4')
    })

    it('should return modelName from the create transaction snapshot', async () => {
      const realTransaction = dbh.db.transaction.bind(dbh.db)
      const transactionSpy = vi.spyOn(dbh.db, 'transaction').mockImplementation((callback, config) => {
        const result = realTransaction(callback, config)
        const { assistant } = result as { assistant: { id: string } }
        dbh.db.update(assistantTable).set({ deletedAt: Date.now() }).where(eq(assistantTable.id, assistant.id)).run()
        return result
      })

      try {
        const result = assistantDataService.create({ name: 'with-model', modelId: 'openai::gpt-4' })

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

      const result = assistantDataService.create({ name: 'stale-pref' })

      expect(result.modelId).toBeNull()
      expect(result.modelName).toBeNull()
    })

    it('should not fall back to preference when caller passes modelId: null explicitly', async () => {
      MockMainPreferenceServiceUtils.setPreferenceValue('chat.default_model_id', createUniqueModelId('openai', 'gpt-4'))

      const result = assistantDataService.create({ name: 'explicit-null', modelId: null })

      expect(result.modelId).toBeNull()
    })
  })

  describe('createFromImport', () => {
    it('keeps runtime context disabled when legacy import settings are omitted', async () => {
      const result = assistantDataService.createFromImport({
        name: 'Imported assistant',
        prompt: 'legacy prompt'
      })

      expect(result.settings.enableRuntimeContext).toBe(false)
    })

    it('preserves explicitly enabled runtime context from an import request', async () => {
      const result = assistantDataService.createFromImport({
        name: 'Imported assistant',
        prompt: 'legacy prompt',
        settings: { ...DEFAULT_ASSISTANT_SETTINGS, enableRuntimeContext: true }
      })

      expect(result.settings.enableRuntimeContext).toBe(true)
    })

    it('creates a long-named legacy group and assigns it to the imported assistant', async () => {
      const groupName = 'x'.repeat(65)

      const result = assistantDataService.createFromImport({
        name: 'Imported assistant',
        prompt: 'legacy prompt',
        groupName
      })

      const [group] = await dbh.db.select().from(groupTable).where(eq(groupTable.name, groupName))
      expect(group).toMatchObject({ entityType: 'assistant', name: groupName })
      expect(result.groupId).toBe(group.id)
    })

    it('reuses one exact-name group across independent import requests', async () => {
      const existingGroupId = '11111111-1111-4111-8111-111111111111'
      await seedAssistantGroup(existingGroupId, 'work')

      const first = assistantDataService.createFromImport({
        name: 'First import',
        prompt: 'first prompt',
        groupName: 'work'
      })
      const second = assistantDataService.createFromImport({
        name: 'Second import',
        prompt: 'second prompt',
        groupName: 'work'
      })

      const matchingGroups = await dbh.db.select().from(groupTable).where(eq(groupTable.name, 'work'))
      expect(matchingGroups).toHaveLength(1)
      expect(first.groupId).toBe(existingGroupId)
      expect(second.groupId).toBe(existingGroupId)
    })
  })

  describe('reorder', () => {
    it("should move an assistant to the first position via { position: 'first' }", async () => {
      await seedAssistantRow([
        { id: 'ast-1', name: 'A', orderKey: 'a0' },
        { id: 'ast-2', name: 'B', orderKey: 'a1' },
        { id: 'ast-3', name: 'C', orderKey: 'a2' }
      ])

      assistantDataService.reorder('ast-3', { position: 'first' })

      const result = assistantDataService.list(listQuery())
      expect(result.items.map((a) => a.id)).toEqual(['ast-3', 'ast-1', 'ast-2'])
    })

    it('should move an assistant before an anchor', async () => {
      await seedAssistantRow([
        { id: 'ast-1', name: 'A', orderKey: 'a0' },
        { id: 'ast-2', name: 'B', orderKey: 'a1' },
        { id: 'ast-3', name: 'C', orderKey: 'a2' }
      ])

      assistantDataService.reorder('ast-3', { before: 'ast-2' })

      const result = assistantDataService.list(listQuery())
      expect(result.items.map((a) => a.id)).toEqual(['ast-1', 'ast-3', 'ast-2'])
    })

    it('should reject soft-deleted targets and anchors as NOT_FOUND', async () => {
      await seedAssistantRow([
        { id: 'ast-1', name: 'A', orderKey: 'a0' },
        { id: 'ast-2', name: 'B', orderKey: 'a1', deletedAt: Date.now() }
      ])

      let targetErr: unknown
      try {
        assistantDataService.reorder('ast-2', { position: 'first' })
      } catch (e) {
        targetErr = e
      }
      expect(targetErr).toMatchObject({
        code: ErrorCode.NOT_FOUND,
        details: { resource: 'Assistant', id: 'ast-2' }
      })
      let anchorErr: unknown
      try {
        assistantDataService.reorder('ast-1', { before: 'ast-2' })
      } catch (e) {
        anchorErr = e
      }
      expect(anchorErr).toMatchObject({
        code: ErrorCode.NOT_FOUND,
        details: { resource: 'Assistant', id: 'ast-2' }
      })
    })
  })

  describe('reorderBatch', () => {
    it('should apply multiple assistant moves atomically', async () => {
      await seedAssistantRow([
        { id: 'ast-1', name: 'A', orderKey: 'a0' },
        { id: 'ast-2', name: 'B', orderKey: 'a1' },
        { id: 'ast-3', name: 'C', orderKey: 'a2' }
      ])

      assistantDataService.reorderBatch([
        { id: 'ast-3', anchor: { position: 'first' } },
        { id: 'ast-1', anchor: { position: 'last' } }
      ])

      const result = assistantDataService.list(listQuery())
      expect(result.items.map((a) => a.id)).toEqual(['ast-3', 'ast-2', 'ast-1'])
    })
  })

  describe('update', () => {
    it('should update and return assistant', async () => {
      await seedAssistantRow({ id: 'ast-1', name: 'original' })

      const result = assistantDataService.update('ast-1', { name: 'updated-name' })
      expect(result.name).toBe('updated-name')
    })

    it('should persist update to database', async () => {
      await seedAssistantRow({ id: 'ast-1', name: 'original' })

      assistantDataService.update('ast-1', { name: 'updated-name' })

      const [row] = await dbh.db.select().from(assistantTable)
      expect(row.name).toBe('updated-name')
    })

    it('should not pass relation fields to the column update', async () => {
      await seedAssistantRow({ id: 'ast-1', name: 'original' })
      await seedMcpServer()

      const result = assistantDataService.update('ast-1', {
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

      const result = assistantDataService.update('ast-1', {
        mcpServerIds: ['srv-1'],
        knowledgeBaseIds: ['kb-1']
      })

      expect(result.mcpServerIds).toEqual(['srv-1'])
      expect(result.knowledgeBaseIds).toEqual(['kb-1'])

      const [row] = await dbh.db.select().from(assistantTable)
      expect(row.name).toBe('original')
      expect(row.modelId).toBe('openai::gpt-4')
    })

    it('should preserve groupId after a column-only update', async () => {
      const groupId = '11111111-1111-4111-8111-111111111111'
      await seedAssistantGroup(groupId, 'work')
      await seedAssistantRow({ id: 'ast-1', name: 'original', groupId })

      const result = assistantDataService.update('ast-1', { name: 'renamed' })

      expect(result.name).toBe('renamed')
      expect(result.groupId).toBe(groupId)
    })

    it('should re-resolve modelName when modelId changes', async () => {
      await seedAssistantRow({ id: 'ast-1', name: 'test', modelId: 'openai::gpt-4' })

      // Sanity: starts as "GPT-4"
      const before = assistantDataService.getById('ast-1')
      expect(before.modelName).toBe('GPT-4')

      const result = assistantDataService.update('ast-1', { modelId: 'anthropic::claude-3' })

      expect(result.modelId).toBe('anthropic::claude-3')
      expect(result.modelName).toBe('Claude 3')
    })

    it('should return changed modelName from the update transaction snapshot', async () => {
      await seedAssistantRow({ id: 'ast-1', name: 'test', modelId: 'openai::gpt-4' })
      const realTransaction = dbh.db.transaction.bind(dbh.db)
      const transactionSpy = vi.spyOn(dbh.db, 'transaction').mockImplementation((callback, config) => {
        const result = realTransaction(callback, config)
        const { row } = result as { row: { id: string } }
        dbh.db.update(assistantTable).set({ deletedAt: Date.now() }).where(eq(assistantTable.id, row.id)).run()
        return result
      })

      try {
        const result = assistantDataService.update('ast-1', { modelId: 'anthropic::claude-3' })

        expect(result.modelName).toBe('Claude 3')
      } finally {
        transactionSpy.mockRestore()
      }
    })

    it('should reuse modelName when modelId is unchanged', async () => {
      await seedAssistantRow({ id: 'ast-1', name: 'original', modelId: 'openai::gpt-4' })

      const result = assistantDataService.update('ast-1', { name: 'renamed' })

      expect(result.name).toBe('renamed')
      expect(result.modelName).toBe('GPT-4')
    })

    it('should replace existing junction rows on relation update', async () => {
      await seedAssistantRow({ id: 'ast-1', name: 'test' })
      await seedMcpServer('srv-1', 'MCP1')
      await seedMcpServer('srv-2', 'MCP2')
      await dbh.db.insert(assistantMcpServerTable).values({ assistantId: 'ast-1', mcpServerId: 'srv-1' })

      assistantDataService.update('ast-1', { mcpServerIds: ['srv-2'] })

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

      assistantDataService.update('ast-1', { mcpServerIds: ['srv-1', 'srv-2'] })

      const mcpRows = await dbh.db.select().from(assistantMcpServerTable)
      expect(mcpRows).toHaveLength(2)
      const srv1Row = mcpRows.find((r) => r.mcpServerId === 'srv-1')
      expect(srv1Row?.createdAt).toBe(1000)
    })

    it('should throw NOT_FOUND when updating non-existent assistant', async () => {
      let err: unknown
      try {
        assistantDataService.update('non-existent', { name: 'x' })
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })

    it('should throw validation error when name is set to empty', async () => {
      await seedAssistantRow({ id: 'ast-1', name: 'original' })

      let err: unknown
      try {
        assistantDataService.update('ast-1', { name: '' })
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({
        code: ErrorCode.VALIDATION_ERROR
      })
    })

    it('should replace groupId on update', async () => {
      const originalGroupId = '11111111-1111-4111-8111-111111111111'
      const nextGroupId = '22222222-2222-4222-8222-222222222222'
      await seedAssistantGroup(originalGroupId, 'work', 'a0')
      await seedAssistantGroup(nextGroupId, 'personal', 'a1')
      await seedAssistantRow({ id: 'ast-1', name: 'test', groupId: originalGroupId })

      const result = assistantDataService.update('ast-1', { groupId: nextGroupId })

      expect(result.groupId).toBe(nextGroupId)
      const [row] = await dbh.db.select().from(assistantTable).where(eq(assistantTable.id, 'ast-1'))
      expect(row.groupId).toBe(nextGroupId)
    })

    it('should clear the group assignment with null', async () => {
      const groupId = '11111111-1111-4111-8111-111111111111'
      await seedAssistantGroup(groupId, 'work')
      await seedAssistantRow({ id: 'ast-1', name: 'test', groupId })

      const result = assistantDataService.update('ast-1', { groupId: null })

      expect(result.groupId).toBeNull()
    })

    it('should leave groupId untouched when it is omitted', async () => {
      const groupId = '11111111-1111-4111-8111-111111111111'
      await seedAssistantGroup(groupId, 'work')
      await seedAssistantRow({ id: 'ast-1', name: 'original', groupId })

      const result = assistantDataService.update('ast-1', { name: 'renamed' })

      expect(result.groupId).toBe(groupId)
    })

    it('should roll the column update back when a referenced group does not exist', async () => {
      await seedAssistantRow({ id: 'ast-1', name: 'original' })

      let err: unknown
      try {
        assistantDataService.update('ast-1', {
          name: 'renamed',
          groupId: '99999999-9999-4999-8999-999999999999'
        })
      } catch (error) {
        err = error
      }

      expect(err).toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        details: { fieldErrors: { groupId: expect.any(Array) } }
      })

      const [row] = await dbh.db.select().from(assistantTable)
      expect(row.name).toBe('original')
    })

    it('should reject an update to a group owned by another entity type', async () => {
      const originalGroupId = '11111111-1111-4111-8111-111111111111'
      const topicGroupId = '22222222-2222-4222-8222-222222222222'
      await seedAssistantGroup(originalGroupId, 'assistants')
      await dbh.db.insert(groupTable).values({ id: topicGroupId, entityType: 'topic', name: 'topics', orderKey: 'a0' })
      await seedAssistantRow({ id: 'ast-1', name: 'original', groupId: originalGroupId })
      let err: unknown

      try {
        assistantDataService.update('ast-1', { name: 'renamed', groupId: topicGroupId })
      } catch (error) {
        err = error
      }

      expect(err).toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        details: { fieldErrors: { groupId: expect.any(Array) } }
      })
      const [row] = await dbh.db.select().from(assistantTable)
      expect(row).toMatchObject({ name: 'original', groupId: originalGroupId })
    })

    it('should atomically roll all junction writes back when any one fails', async () => {
      // Covers column update + mcpServer sync in one transaction. A bad groupId
      // must not leave partial column or relation writes.
      await seedAssistantRow({ id: 'ast-1', name: 'before' })
      await seedMcpServer('srv-1')

      expect(() =>
        assistantDataService.update('ast-1', {
          name: 'after',
          mcpServerIds: ['srv-1'],
          groupId: '99999999-9999-4999-8999-999999999999'
        })
      ).toThrow()

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

      const originalGetById = assistantDataService.getById.bind(assistantDataService)
      const getByIdSpy = vi.spyOn(assistantDataService, 'getById').mockImplementation((id: string, options) => {
        const result = originalGetById(id, options)
        // Between the entry-level getById and the tx, simulate a concurrent
        // DELETE /assistants/:id from another window.
        dbh.db.update(assistantTable).set({ deletedAt: Date.now() }).where(eq(assistantTable.id, id)).run()
        return result
      })

      let err: unknown
      try {
        assistantDataService.update('ast-1', {
          name: 'after',
          mcpServerIds: ['srv-1']
        })
      } catch (e) {
        err = e
      } finally {
        getByIdSpy.mockRestore()
      }
      expect(err).toMatchObject({ code: ErrorCode.NOT_FOUND })

      // Row stays soft-deleted with its original name; no junction rows landed.
      const [row] = await dbh.db.select().from(assistantTable)
      expect(row.name).toBe('before')
      expect(row.deletedAt).not.toBeNull()
      const mcpRows = await dbh.db.select().from(assistantMcpServerTable)
      expect(mcpRows).toHaveLength(0)
    })

    it('should reject with VALIDATION_ERROR when update modelId is not in user_model', async () => {
      await seedAssistantRow({ id: 'ast-1', name: 'before' })

      let err: unknown
      try {
        assistantDataService.update('ast-1', { modelId: 'cherryai::qwen' })
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({
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
      const getByIdSpy = vi.spyOn(assistantDataService, 'getById').mockImplementation((id: string, options) => {
        const result = originalGetById(id, options)
        dbh.db.update(assistantTable).set({ deletedAt: Date.now() }).where(eq(assistantTable.id, id)).run()
        return result
      })

      let err: unknown
      try {
        assistantDataService.update('ast-1', { mcpServerIds: ['srv-1'] })
      } catch (e) {
        err = e
      } finally {
        getByIdSpy.mockRestore()
      }
      expect(err).toMatchObject({
        code: ErrorCode.NOT_FOUND
      })

      const mcpRows = await dbh.db.select().from(assistantMcpServerTable)
      expect(mcpRows).toHaveLength(0)
    })
  })

  describe('delete', () => {
    it('should soft-delete by setting deletedAt timestamp', async () => {
      await seedAssistantRow({ id: 'ast-1', name: 'test' })

      assistantDataService.delete('ast-1')

      const [row] = await dbh.db.select().from(assistantTable)
      expect(row.deletedAt).toBeTruthy()
      expect(typeof row.deletedAt).toBe('number')
    })

    it('should not physically remove the row', async () => {
      await seedAssistantRow({ id: 'ast-1', name: 'test' })

      assistantDataService.delete('ast-1')

      const rows = await dbh.db.select().from(assistantTable)
      expect(rows).toHaveLength(1)
    })

    it('should clear groupId for the deleted assistant', async () => {
      const groupId = '11111111-1111-4111-8111-111111111111'
      await seedAssistantGroup(groupId, 'work')
      await seedAssistantRow({ id: 'ast-1', name: 'test', groupId })

      assistantDataService.delete('ast-1')

      const [row] = await dbh.db.select().from(assistantTable)
      expect(row.groupId).toBeNull()
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

      assistantDataService.delete('ast-1')

      const pinRows = await dbh.db.select().from(pinTable)
      expect(pinRows).toHaveLength(0)
    })

    it('should delete assistant topics atomically when requested', async () => {
      await seedAssistantRow([
        { id: 'ast-1', name: 'delete with topics' },
        { id: 'ast-2', name: 'keep topics' }
      ])
      await dbh.db.insert(topicTable).values([
        { id: 'topic-1', name: '', assistantId: 'ast-1', orderKey: 'a0' },
        { id: 'topic-2', name: 'kept', assistantId: 'ast-2', orderKey: 'a1' }
      ])

      const result = assistantDataService.delete('ast-1', { deleteTopics: true })

      expect(result.deleted).toBe(true)
      expect(result.deletedTopicIds).toEqual(['topic-1'])
      const assistantRows = await dbh.db.select().from(assistantTable).where(eq(assistantTable.id, 'ast-1'))
      expect(assistantRows[0].deletedAt).toBeTruthy()
      const topicRows = await dbh.db.select().from(topicTable)
      expect(topicRows.map((row) => row.id)).toEqual(['topic-2'])
    })

    it('should roll back assistant delete when topic deletion fails', async () => {
      await seedAssistantRow({ id: 'ast-1', name: 'rollback' })
      const deleteTopicsSpy = vi.spyOn(topicService, 'deleteByAssistantIdTx').mockImplementationOnce(() => {
        throw new Error('topic delete failed')
      })

      try {
        expect(() => assistantDataService.delete('ast-1', { deleteTopics: true })).toThrow('topic delete failed')
      } finally {
        deleteTopicsSpy.mockRestore()
      }

      const [row] = await dbh.db.select().from(assistantTable).where(eq(assistantTable.id, 'ast-1'))
      expect(row.deletedAt).toBeNull()
    })

    it('should throw NOT_FOUND when deleting non-existent assistant', async () => {
      let err: unknown
      try {
        assistantDataService.delete('non-existent')
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })

    it('should throw NOT_FOUND when deleting already-deleted assistant', async () => {
      await seedAssistantRow({ id: 'ast-1', name: 'test', deletedAt: Date.now() })

      let err: unknown
      try {
        assistantDataService.delete('ast-1')
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })
  })

  describe('db constraints', () => {
    it('should cascade-delete junction rows when assistant is physically deleted', async () => {
      await seedAssistantRow({ id: 'ast-1', name: 'test' })
      await seedMcpServer()
      await dbh.db.insert(assistantMcpServerTable).values({ assistantId: 'ast-1', mcpServerId: 'srv-1' })

      dbh.sqlite.prepare('DELETE FROM assistant WHERE id = ?').run('ast-1')

      const mcpRows = await dbh.db.select().from(assistantMcpServerTable)
      expect(mcpRows).toHaveLength(0)
    })

    it('should cascade-delete junction rows when mcp_server is deleted', async () => {
      await seedAssistantRow({ id: 'ast-1', name: 'test' })
      await seedMcpServer()
      await dbh.db.insert(assistantMcpServerTable).values({ assistantId: 'ast-1', mcpServerId: 'srv-1' })

      dbh.sqlite.prepare('DELETE FROM mcp_server WHERE id = ?').run('srv-1')

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

  describe('search', () => {
    it('returns lean navigation items ordered by updatedAt', async () => {
      await seedAssistantRow([
        {
          id: 'ast-search-old',
          name: 'Needle Old',
          description: 'old assistant',
          emoji: 'A',
          updatedAt: 100
        },
        {
          id: 'ast-search-new',
          name: 'Needle New',
          description: 'new assistant',
          emoji: 'B',
          updatedAt: 200
        },
        {
          id: 'ast-search-miss',
          name: 'Other',
          description: 'not included',
          emoji: 'C',
          updatedAt: 300
        }
      ])

      const result = assistantDataService.search({ q: 'Needle', limit: 5 })

      expect(result).toEqual([
        {
          type: 'assistant',
          id: 'ast-search-new',
          title: 'Needle New',
          subtitle: 'new assistant',
          emoji: 'B',
          updatedAt: '1970-01-01T00:00:00.200Z',
          target: { assistantId: 'ast-search-new' }
        },
        {
          type: 'assistant',
          id: 'ast-search-old',
          title: 'Needle Old',
          subtitle: 'old assistant',
          emoji: 'A',
          updatedAt: '1970-01-01T00:00:00.100Z',
          target: { assistantId: 'ast-search-old' }
        }
      ])
      expect(result[0]).not.toHaveProperty('mcpServerIds')
      expect(result[0]).not.toHaveProperty('tags')
    })

    it('treats whitespace-only q as an absent search predicate', async () => {
      await seedAssistantRow([
        {
          id: 'ast-blank-old',
          name: 'Alpha',
          updatedAt: 100
        },
        {
          id: 'ast-blank-new',
          name: 'Beta',
          updatedAt: 200
        },
        {
          id: 'ast-blank-deleted',
          name: 'Deleted',
          deletedAt: 300,
          updatedAt: 300
        }
      ])

      const result = assistantDataService.search({ q: '   ', limit: 5 })

      expect(result.map((item) => item.id)).toEqual(['ast-blank-new', 'ast-blank-old'])
    })
  })
})
