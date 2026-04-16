import { assistantTable } from '@data/db/schemas/assistant'
import { assistantKnowledgeBaseTable, assistantMcpServerTable } from '@data/db/schemas/assistantRelations'
import type { DbType } from '@data/db/types'
import { createClient } from '@libsql/client'
import { ErrorCode } from '@shared/data/api'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/libsql'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================================
// DB Setup
// ============================================================================

let realDb: DbType | null = null
let closeClient: (() => void) | undefined

vi.mock('@main/core/application', () => ({
  application: {
    get: vi.fn(() => ({
      getDb: vi.fn(() => realDb)
    }))
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    })
  }
}))

const { AssistantDataService, assistantDataService } = await import('../AssistantService')

async function setupDb() {
  const client = createClient({ url: 'file::memory:' })
  closeClient = () => client.close()
  realDb = drizzle({ client, casing: 'snake_case' })
  const db = realDb

  await db.run(sql`PRAGMA foreign_keys = ON`)

  // libsql creates a separate connection for transactions on in-memory DBs,
  // losing the schema. Bypass by executing the callback on the main connection.
  ;(db as any).transaction = async (fn: (tx: any) => Promise<any>) => fn(db)

  // Assistant table
  await db.run(
    sql.raw(`
    CREATE TABLE user_model (
      id TEXT PRIMARY KEY NOT NULL
    )
  `)
  )

  await db.run(
    sql.raw(`
    INSERT INTO user_model (id) VALUES
      ('openai::gpt-4'),
      ('anthropic::claude-3')
  `)
  )

  await db.run(
    sql.raw(`
    CREATE TABLE assistant (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      prompt TEXT DEFAULT '',
      emoji TEXT,
      description TEXT DEFAULT '',
      model_id TEXT,
      settings TEXT,
      created_at INTEGER,
      updated_at INTEGER,
      deleted_at INTEGER,
      FOREIGN KEY (model_id) REFERENCES user_model(id) ON DELETE SET NULL
    )
  `)
  )

  // MCP server stub (FK target for junction)
  await db.run(
    sql.raw(`
    CREATE TABLE mcp_server (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      created_at INTEGER,
      updated_at INTEGER
    )
  `)
  )

  // Knowledge base stub (FK target for junction)
  await db.run(
    sql.raw(`
    CREATE TABLE knowledge_base (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      embedding_model_id TEXT NOT NULL,
      created_at INTEGER,
      updated_at INTEGER
    )
  `)
  )

  // Junction tables
  await db.run(
    sql.raw(`
    CREATE TABLE assistant_mcp_server (
      assistant_id TEXT NOT NULL REFERENCES assistant(id) ON DELETE CASCADE,
      mcp_server_id TEXT NOT NULL REFERENCES mcp_server(id) ON DELETE CASCADE,
      created_at INTEGER,
      updated_at INTEGER,
      PRIMARY KEY (assistant_id, mcp_server_id)
    )
  `)
  )

  await db.run(
    sql.raw(`
    CREATE TABLE assistant_knowledge_base (
      assistant_id TEXT NOT NULL REFERENCES assistant(id) ON DELETE CASCADE,
      knowledge_base_id TEXT NOT NULL REFERENCES knowledge_base(id) ON DELETE CASCADE,
      created_at INTEGER,
      updated_at INTEGER,
      PRIMARY KEY (assistant_id, knowledge_base_id)
    )
  `)
  )

  return db
}

// ============================================================================
// Tests
// ============================================================================

describe('AssistantDataService', () => {
  beforeEach(async () => {
    await setupDb()
  })

  afterEach(() => {
    closeClient?.()
    closeClient = undefined
    realDb = null
  })

  it('should export a module-level singleton', () => {
    expect(assistantDataService).toBeInstanceOf(AssistantDataService)
  })

  // --------------------------------------------------------------------------
  // getById
  // --------------------------------------------------------------------------
  describe('getById', () => {
    it('should return an assistant with relation ids when found', async () => {
      const db = realDb!
      await db.insert(assistantTable).values({ id: 'ast-1', name: 'test', modelId: 'openai::gpt-4' })
      await db.run(sql.raw(`INSERT INTO mcp_server (id, name) VALUES ('srv-1', 'MCP')`))
      await db.run(
        sql.raw(
          `INSERT INTO knowledge_base (id, name, dimensions, embedding_model_id) VALUES ('kb-1', 'KB', 1024, 'openai::text-embedding-3-large')`
        )
      )
      await db.insert(assistantMcpServerTable).values({ assistantId: 'ast-1', mcpServerId: 'srv-1' })
      await db.insert(assistantKnowledgeBaseTable).values({ assistantId: 'ast-1', knowledgeBaseId: 'kb-1' })

      const result = await assistantDataService.getById('ast-1')

      expect(result.id).toBe('ast-1')
      expect(result.name).toBe('test')
      expect(result.modelId).toBe('openai::gpt-4')
      expect(result.mcpServerIds).toEqual(['srv-1'])
      expect(result.knowledgeBaseIds).toEqual(['kb-1'])
      expect(typeof result.createdAt).toBe('string')
    })

    it('should return null modelId when not set', async () => {
      const db = realDb!
      await db.insert(assistantTable).values({ id: 'ast-1', name: 'test' })

      const result = await assistantDataService.getById('ast-1')
      expect(result.modelId).toBeNull()
    })

    it('should apply default values for nullable fields', async () => {
      const db = realDb!
      await db.insert(assistantTable).values({ id: 'ast-1', name: 'test' })

      const result = await assistantDataService.getById('ast-1')
      expect(result.prompt).toBe('')
      expect(result.emoji).toBe('🌟')
      expect(result.description).toBe('')
      expect(result.mcpServerIds).toEqual([])
      expect(result.knowledgeBaseIds).toEqual([])
    })

    it('should return soft-deleted assistant when includeDeleted is true', async () => {
      const db = realDb!
      await db.insert(assistantTable).values({ id: 'ast-1', name: 'test' })
      await db.update(assistantTable).set({ deletedAt: Date.now() })

      const result = await assistantDataService.getById('ast-1', { includeDeleted: true })
      expect(result.id).toBe('ast-1')
    })

    it('should NOT return soft-deleted assistant by default', async () => {
      const db = realDb!
      await db.insert(assistantTable).values({ id: 'ast-1', name: 'test' })
      await db.update(assistantTable).set({ deletedAt: Date.now() })

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

  // --------------------------------------------------------------------------
  // list
  // --------------------------------------------------------------------------
  describe('list', () => {
    it('should return all assistants with relation ids', async () => {
      const db = realDb!
      await db.insert(assistantTable).values([
        { id: 'ast-1', name: 'first', modelId: 'openai::gpt-4', createdAt: 100 },
        { id: 'ast-2', name: 'second', modelId: 'anthropic::claude-3', createdAt: 200 }
      ])
      await db.run(sql.raw(`INSERT INTO mcp_server (id, name) VALUES ('srv-1', 'MCP')`))
      await db.insert(assistantMcpServerTable).values({ assistantId: 'ast-2', mcpServerId: 'srv-1' })

      const result = await assistantDataService.list({})

      expect(result.items).toHaveLength(2)
      expect(result.total).toBe(2)
      expect(result.page).toBe(1)
      expect(result.items[0].id).toBe('ast-1')
      expect(result.items[1].mcpServerIds).toEqual(['srv-1'])
    })

    it('should exclude soft-deleted assistants', async () => {
      const db = realDb!
      await db.insert(assistantTable).values([
        { id: 'ast-1', name: 'active' },
        { id: 'ast-2', name: 'deleted', deletedAt: Date.now() }
      ])

      const result = await assistantDataService.list({})
      expect(result.items).toHaveLength(1)
      expect(result.items[0].id).toBe('ast-1')
      expect(result.total).toBe(1)
    })

    it('should filter by id', async () => {
      const db = realDb!
      await db.insert(assistantTable).values([
        { id: 'ast-1', name: 'first' },
        { id: 'ast-2', name: 'second' }
      ])

      const result = await assistantDataService.list({ id: 'ast-2' })
      expect(result.items).toHaveLength(1)
      expect(result.items[0].id).toBe('ast-2')
    })

    it('should respect page and limit parameters', async () => {
      const db = realDb!
      const values = Array.from({ length: 5 }, (_, i) => ({
        id: `ast-${i}`,
        name: `assistant-${i}`,
        createdAt: i * 100
      }))
      await db.insert(assistantTable).values(values)

      const result = await assistantDataService.list({ page: 2, limit: 2 })
      expect(result.page).toBe(2)
      expect(result.total).toBe(5)
      expect(result.items).toHaveLength(2)
      expect(result.items[0].id).toBe('ast-2')
      expect(result.items[1].id).toBe('ast-3')
    })

    it('should order by createdAt ascending', async () => {
      const db = realDb!
      await db.insert(assistantTable).values([
        { id: 'ast-new', name: 'new', createdAt: 300 },
        { id: 'ast-old', name: 'old', createdAt: 100 },
        { id: 'ast-mid', name: 'mid', createdAt: 200 }
      ])

      const result = await assistantDataService.list({})
      expect(result.items.map((a) => a.id)).toEqual(['ast-old', 'ast-mid', 'ast-new'])
    })
  })

  // --------------------------------------------------------------------------
  // create
  // --------------------------------------------------------------------------
  describe('create', () => {
    it('should create and return assistant with generated id', async () => {
      const result = await assistantDataService.create({ name: 'test-assistant' })

      expect(result.id).toBeTruthy()
      expect(result.name).toBe('test-assistant')
      expect(result.modelId).toBeNull()
      expect(typeof result.createdAt).toBe('string')
    })

    it('should persist assistant to database', async () => {
      const db = realDb!
      const created = await assistantDataService.create({ name: 'test-assistant' })

      const [row] = await db.select().from(assistantTable)
      expect(row.id).toBe(created.id)
      expect(row.name).toBe('test-assistant')
    })

    it('should sync junction rows when relation ids are provided', async () => {
      const db = realDb!
      await db.run(sql.raw(`INSERT INTO mcp_server (id, name) VALUES ('srv-1', 'MCP')`))
      await db.run(
        sql.raw(
          `INSERT INTO knowledge_base (id, name, dimensions, embedding_model_id) VALUES ('kb-1', 'KB', 1024, 'model')`
        )
      )

      const result = await assistantDataService.create({
        name: 'test-assistant',
        modelId: 'openai::gpt-4',
        mcpServerIds: ['srv-1'],
        knowledgeBaseIds: ['kb-1']
      })

      expect(result.mcpServerIds).toEqual(['srv-1'])
      expect(result.knowledgeBaseIds).toEqual(['kb-1'])

      // Verify junction rows in DB
      const mcpRows = await db.select().from(assistantMcpServerTable)
      const kbRows = await db.select().from(assistantKnowledgeBaseTable)
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

  // --------------------------------------------------------------------------
  // update
  // --------------------------------------------------------------------------
  describe('update', () => {
    it('should update and return assistant', async () => {
      const db = realDb!
      await db.insert(assistantTable).values({ id: 'ast-1', name: 'original' })

      const result = await assistantDataService.update('ast-1', { name: 'updated-name' })
      expect(result.name).toBe('updated-name')
    })

    it('should persist update to database', async () => {
      const db = realDb!
      await db.insert(assistantTable).values({ id: 'ast-1', name: 'original' })

      await assistantDataService.update('ast-1', { name: 'updated-name' })

      const [row] = await db.select().from(assistantTable)
      expect(row.name).toBe('updated-name')
    })

    it('should not pass relation fields to the column update', async () => {
      const db = realDb!
      await db.insert(assistantTable).values({ id: 'ast-1', name: 'original' })
      await db.run(sql.raw(`INSERT INTO mcp_server (id, name) VALUES ('srv-1', 'MCP')`))

      const result = await assistantDataService.update('ast-1', {
        name: 'updated',
        mcpServerIds: ['srv-1']
      })

      expect(result.name).toBe('updated')
      expect(result.mcpServerIds).toEqual(['srv-1'])

      // Verify junction row created
      const mcpRows = await db.select().from(assistantMcpServerTable)
      expect(mcpRows).toHaveLength(1)
    })

    it('should handle relation-only updates without modifying assistant columns', async () => {
      const db = realDb!
      await db.insert(assistantTable).values({ id: 'ast-1', name: 'original', modelId: 'openai::gpt-4' })
      await db.run(sql.raw(`INSERT INTO mcp_server (id, name) VALUES ('srv-1', 'MCP')`))
      await db.run(
        sql.raw(
          `INSERT INTO knowledge_base (id, name, dimensions, embedding_model_id) VALUES ('kb-1', 'KB', 1024, 'model')`
        )
      )

      const result = await assistantDataService.update('ast-1', {
        mcpServerIds: ['srv-1'],
        knowledgeBaseIds: ['kb-1']
      })

      // Relations updated
      expect(result.mcpServerIds).toEqual(['srv-1'])
      expect(result.knowledgeBaseIds).toEqual(['kb-1'])

      // Column data unchanged
      const [row] = await db.select().from(assistantTable)
      expect(row.name).toBe('original')
      expect(row.modelId).toBe('openai::gpt-4')
    })

    it('should replace existing junction rows on relation update', async () => {
      const db = realDb!
      await db.insert(assistantTable).values({ id: 'ast-1', name: 'test' })
      await db.run(sql.raw(`INSERT INTO mcp_server (id, name) VALUES ('srv-1', 'MCP1'), ('srv-2', 'MCP2')`))
      await db.insert(assistantMcpServerTable).values({ assistantId: 'ast-1', mcpServerId: 'srv-1' })

      await assistantDataService.update('ast-1', { mcpServerIds: ['srv-2'] })

      const mcpRows = await db.select().from(assistantMcpServerTable)
      expect(mcpRows).toHaveLength(1)
      expect(mcpRows[0].mcpServerId).toBe('srv-2')
    })

    it('should preserve junction createdAt for unchanged relations on PATCH', async () => {
      const db = realDb!
      await db.insert(assistantTable).values({ id: 'ast-1', name: 'test' })
      await db.run(sql.raw(`INSERT INTO mcp_server (id, name) VALUES ('srv-1', 'MCP1'), ('srv-2', 'MCP2')`))
      // Insert with known createdAt
      await db.run(
        sql.raw(
          `INSERT INTO assistant_mcp_server (assistant_id, mcp_server_id, created_at) VALUES ('ast-1', 'srv-1', 1000)`
        )
      )

      // Update: keep srv-1, add srv-2
      await assistantDataService.update('ast-1', { mcpServerIds: ['srv-1', 'srv-2'] })

      const mcpRows = await db.select().from(assistantMcpServerTable)
      expect(mcpRows).toHaveLength(2)
      // srv-1's createdAt should be preserved (not reset)
      const srv1Row = mcpRows.find((r) => r.mcpServerId === 'srv-1')
      expect(srv1Row?.createdAt).toBe(1000)
    })

    it('should throw NOT_FOUND when updating non-existent assistant', async () => {
      await expect(assistantDataService.update('non-existent', { name: 'x' })).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })

    it('should throw validation error when name is set to empty', async () => {
      const db = realDb!
      await db.insert(assistantTable).values({ id: 'ast-1', name: 'original' })

      await expect(assistantDataService.update('ast-1', { name: '' })).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR
      })
    })
  })

  // --------------------------------------------------------------------------
  // delete
  // --------------------------------------------------------------------------
  describe('delete', () => {
    it('should soft-delete by setting deletedAt timestamp', async () => {
      const db = realDb!
      await db.insert(assistantTable).values({ id: 'ast-1', name: 'test' })

      await assistantDataService.delete('ast-1')

      const [row] = await db.select().from(assistantTable)
      expect(row.deletedAt).toBeTruthy()
      expect(typeof row.deletedAt).toBe('number')
    })

    it('should not physically remove the row', async () => {
      const db = realDb!
      await db.insert(assistantTable).values({ id: 'ast-1', name: 'test' })

      await assistantDataService.delete('ast-1')

      const rows = await db.select().from(assistantTable)
      expect(rows).toHaveLength(1)
    })

    it('should throw NOT_FOUND when deleting non-existent assistant', async () => {
      await expect(assistantDataService.delete('non-existent')).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })

    it('should throw NOT_FOUND when deleting already-deleted assistant', async () => {
      const db = realDb!
      await db.insert(assistantTable).values({ id: 'ast-1', name: 'test', deletedAt: Date.now() })

      await expect(assistantDataService.delete('ast-1')).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })
  })

  // --------------------------------------------------------------------------
  // DB constraints
  // --------------------------------------------------------------------------
  describe('db constraints', () => {
    it('should cascade-delete junction rows when assistant is physically deleted', async () => {
      const db = realDb!
      await db.insert(assistantTable).values({ id: 'ast-1', name: 'test' })
      await db.run(sql.raw(`INSERT INTO mcp_server (id, name) VALUES ('srv-1', 'MCP')`))
      await db.insert(assistantMcpServerTable).values({ assistantId: 'ast-1', mcpServerId: 'srv-1' })

      // Physical delete (not soft-delete)
      await db.run(sql.raw(`DELETE FROM assistant WHERE id = 'ast-1'`))

      const mcpRows = await db.select().from(assistantMcpServerTable)
      expect(mcpRows).toHaveLength(0)
    })

    it('should cascade-delete junction rows when mcp_server is deleted', async () => {
      const db = realDb!
      await db.insert(assistantTable).values({ id: 'ast-1', name: 'test' })
      await db.run(sql.raw(`INSERT INTO mcp_server (id, name) VALUES ('srv-1', 'MCP')`))
      await db.insert(assistantMcpServerTable).values({ assistantId: 'ast-1', mcpServerId: 'srv-1' })

      await db.run(sql.raw(`DELETE FROM mcp_server WHERE id = 'srv-1'`))

      const mcpRows = await db.select().from(assistantMcpServerTable)
      expect(mcpRows).toHaveLength(0)
    })

    it('should reject duplicate junction rows', async () => {
      const db = realDb!
      await db.insert(assistantTable).values({ id: 'ast-1', name: 'test' })
      await db.run(sql.raw(`INSERT INTO mcp_server (id, name) VALUES ('srv-1', 'MCP')`))
      await db.insert(assistantMcpServerTable).values({ assistantId: 'ast-1', mcpServerId: 'srv-1' })

      await expect(
        db.insert(assistantMcpServerTable).values({ assistantId: 'ast-1', mcpServerId: 'srv-1' })
      ).rejects.toThrow()
    })
  })
})
