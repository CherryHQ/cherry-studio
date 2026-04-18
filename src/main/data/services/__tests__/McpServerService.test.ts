import { mcpServerTable } from '@data/db/schemas/mcpServer'
import { MCPServerService, mcpServerService } from '@data/services/McpServerService'
import { DataApiError, ErrorCode } from '@shared/data/api'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

describe('MCPServerService', () => {
  const dbh = setupTestDatabase()

  async function seedServer(overrides: Partial<typeof mcpServerTable.$inferInsert> = {}) {
    const values: typeof mcpServerTable.$inferInsert = {
      id: 'srv-1',
      name: 'test-server',
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'my-server'],
      env: { API_KEY: 'test' },
      isActive: false,
      installSource: 'manual',
      ...overrides
    }
    await dbh.db.insert(mcpServerTable).values(values)
    return values
  }

  it('should export a module-level singleton', () => {
    expect(mcpServerService).toBeInstanceOf(MCPServerService)
  })

  describe('getById', () => {
    it('should return a server when found', async () => {
      await seedServer()

      const result = await mcpServerService.getById('srv-1')
      expect(result.id).toBe('srv-1')
      expect(result.name).toBe('test-server')
      expect(result.isActive).toBe(false)
      expect(typeof result.createdAt).toBe('string')
    })

    it('should throw NOT_FOUND when server does not exist', async () => {
      await expect(mcpServerService.getById('non-existent')).rejects.toThrow(DataApiError)
      await expect(mcpServerService.getById('non-existent')).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })
  })

  describe('list', () => {
    it('should return all servers when no filters', async () => {
      await seedServer({ id: 'srv-1', name: 'first' })
      await seedServer({ id: 'srv-2', name: 'second' })

      const result = await mcpServerService.list({})
      expect(result.items).toHaveLength(2)
      expect(result.total).toBe(2)
    })

    it('should filter by isActive', async () => {
      await seedServer({ id: 'srv-a', isActive: true })
      await seedServer({ id: 'srv-b', isActive: false })

      const result = await mcpServerService.list({ isActive: true })
      expect(result.items).toHaveLength(1)
      expect(result.items[0].isActive).toBe(true)
    })

    it('should filter by type', async () => {
      await seedServer({ id: 'srv-stdio', type: 'stdio' })
      await seedServer({ id: 'srv-sse', type: 'sse' })

      const result = await mcpServerService.list({ type: 'sse' })
      expect(result.items).toHaveLength(1)
      expect(result.items[0].type).toBe('sse')
    })
  })

  describe('create', () => {
    it('should create and return server', async () => {
      const result = await mcpServerService.create({ name: 'test-server', command: 'npx' })
      expect(result.name).toBe('test-server')

      const rows = await dbh.db.select().from(mcpServerTable)
      expect(rows).toHaveLength(1)
    })

    it('should throw validation error when name is empty', async () => {
      await expect(mcpServerService.create({ name: '' })).rejects.toThrow(DataApiError)
      await expect(mcpServerService.create({ name: '' })).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR
      })
    })

    it('should throw validation error when name is whitespace only', async () => {
      await expect(mcpServerService.create({ name: '   ' })).rejects.toThrow(DataApiError)
    })
  })

  describe('update', () => {
    it('should update and return server', async () => {
      await seedServer()

      const result = await mcpServerService.update('srv-1', { name: 'updated-name' })
      expect(result.name).toBe('updated-name')

      const [row] = await dbh.db.select().from(mcpServerTable).where(eq(mcpServerTable.id, 'srv-1'))
      expect(row.name).toBe('updated-name')
    })

    it('should throw NOT_FOUND when updating non-existent server', async () => {
      await expect(mcpServerService.update('non-existent', { name: 'x' })).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })

    it('should throw validation error when name is set to empty', async () => {
      await seedServer()

      await expect(mcpServerService.update('srv-1', { name: '' })).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR
      })
    })
  })

  describe('delete', () => {
    it('should delete an existing server', async () => {
      await seedServer()

      await expect(mcpServerService.delete('srv-1')).resolves.toBeUndefined()

      const rows = await dbh.db.select().from(mcpServerTable)
      expect(rows).toHaveLength(0)
    })

    it('should throw NOT_FOUND when deleting non-existent server', async () => {
      await expect(mcpServerService.delete('non-existent')).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })
  })

  describe('findByIdOrName', () => {
    it('should return server when found by id', async () => {
      await seedServer()

      const result = await mcpServerService.findByIdOrName('srv-1')
      expect(result).toBeDefined()
      expect(result!.id).toBe('srv-1')
    })

    it('should fall back to name lookup when id not found', async () => {
      await seedServer({ id: 'srv-x', name: 'my-server' })

      const result = await mcpServerService.findByIdOrName('my-server')
      expect(result).toBeDefined()
      expect(result!.name).toBe('my-server')
    })

    it('should return undefined when not found by id or name', async () => {
      const result = await mcpServerService.findByIdOrName('non-existent')
      expect(result).toBeUndefined()
    })
  })

  describe('reorder', () => {
    it('should update sortOrder for each server in a transaction', async () => {
      await seedServer({ id: 'srv-a', name: 'A', sortOrder: 0 })
      await seedServer({ id: 'srv-b', name: 'B', sortOrder: 0 })
      await seedServer({ id: 'srv-c', name: 'C', sortOrder: 0 })

      await mcpServerService.reorder(['srv-c', 'srv-a', 'srv-b'])

      const rows = await dbh.db.select().from(mcpServerTable)
      const byId = new Map(rows.map((r) => [r.id, r]))
      expect(byId.get('srv-c')!.sortOrder).toBe(0)
      expect(byId.get('srv-a')!.sortOrder).toBe(1)
      expect(byId.get('srv-b')!.sortOrder).toBe(2)
    })

    it('should handle empty array', async () => {
      await expect(mcpServerService.reorder([])).resolves.toBeUndefined()
    })
  })
})
