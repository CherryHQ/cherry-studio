import { assistantTable } from '@data/db/schemas/assistant'
import { assistantKnowledgeBaseTable, assistantMcpServerTable } from '@data/db/schemas/assistantRelations'
import { knowledgeBaseTable } from '@data/db/schemas/knowledge'
import { mcpServerTable } from '@data/db/schemas/mcpServer'
import { pinTable } from '@data/db/schemas/pin'
import { entityTagTable, tagTable } from '@data/db/schemas/tagging'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { AssistantDataService, assistantDataService } from '@data/services/AssistantService'
import { generateOrderKeySequence } from '@data/services/utils/orderKey'
import { ErrorCode } from '@shared/data/api'
import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'
import { createUniqueModelId } from '@shared/data/types/model'
import { setupTestDatabase } from '@test-helpers/db'
import { beforeEach, describe, expect, it } from 'vitest'

describe('AssistantDataService', () => {
  const dbh = setupTestDatabase()

  beforeEach(async () => {
    await seedModelRefs()
  })

  async function seedModelRefs() {
    const [openaiKey, anthropicKey] = generateOrderKeySequence(2)
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
      dimensions: 1024,
      embeddingModelId: createUniqueModelId('openai', 'text-embedding-3-large')
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
  })

  describe('list', () => {
    it('should return all assistants with relation ids', async () => {
      await seedAssistantRow([
        { id: 'ast-1', name: 'first', modelId: 'openai::gpt-4', createdAt: 100 },
        { id: 'ast-2', name: 'second', modelId: 'anthropic::claude-3', createdAt: 200 }
      ])
      await seedMcpServer()
      await dbh.db.insert(assistantMcpServerTable).values({ assistantId: 'ast-2', mcpServerId: 'srv-1' })

      const result = await assistantDataService.list({})

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

      const result = await assistantDataService.list({})
      expect(result.items).toHaveLength(1)
      expect(result.items[0].id).toBe('ast-1')
      expect(result.total).toBe(1)
    })

    it('should filter by id', async () => {
      await seedAssistantRow([
        { id: 'ast-1', name: 'first' },
        { id: 'ast-2', name: 'second' }
      ])

      const result = await assistantDataService.list({ id: 'ast-2' })
      expect(result.items).toHaveLength(1)
      expect(result.items[0].id).toBe('ast-2')
    })

    it('should respect page and limit parameters', async () => {
      await seedAssistantRow(
        Array.from({ length: 5 }, (_, i) => ({
          id: `ast-${i}`,
          name: `assistant-${i}`,
          createdAt: i * 100
        }))
      )

      const result = await assistantDataService.list({ page: 2, limit: 2 })
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

      const result = await assistantDataService.list({})
      expect(result.items.map((a) => a.id)).toEqual(['ast-old', 'ast-mid', 'ast-new'])
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
