import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { mcpServerTable } from '@data/db/schemas/mcpServer'
import { mcpServerService } from '@data/services/McpServerService'
import { DataApiError, ErrorCode } from '@shared/data/api/errors'
import { BuiltinMcpServerNames } from '@shared/utils/mcp'

describe('McpServerService', () => {
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

  describe('findByConfig', () => {
    const config = {
      name: 'test-server',
      type: 'stdio' as const,
      command: 'npx',
      args: ['-y', 'my-server'],
      env: { API_KEY: 'test', OTHER: 'x' }
    }

    it('finds an equivalent stdio definition independent of ordinary object key order', async () => {
      await seedServer({ env: { OTHER: 'x', API_KEY: 'test' } })
      const before = dbh.db.select().from(mcpServerTable).all()
      expect(mcpServerService.findByConfig({ ...config, command: ' npx ' })?.id).toBe('srv-1')
      expect(dbh.db.select().from(mcpServerTable).all()).toEqual(before)
    })

    it.each(['sse', 'streamableHttp'] as const)(
      'finds an equivalent remote definition using effective request headers: %s',
      async (type) => {
        await seedServer({ type, baseUrl: 'https://example.com', headers: { Authorization: 'secret' } })
        expect(
          mcpServerService.findByConfig({
            name: 'test-server',
            type,
            baseUrl: 'https://example.com',
            headers: { authorization: 'secret' }
          })?.id
        ).toBe('srv-1')
        dbh.db.update(mcpServerTable).set({ headers: null }).run()
        expect(
          mcpServerService.findByConfig({
            name: 'test-server',
            type,
            baseUrl: 'https://example.com',
            headers: { 'HTTP-Referer': 'https://cherry-ai.com', 'X-Title': 'Cherry Studio' }
          })?.id
        ).toBe('srv-1')
      }
    )

    it('does not merge remote headers with different effective credentials', async () => {
      await seedServer({ type: 'sse', baseUrl: 'https://example.com', headers: { Authorization: 'secret' } })
      for (const headers of [{ authorization: 'other' }, {}, { authorization: '' }] as Record<string, string>[])
        expect(
          mcpServerService.findByConfig({ name: 'test-server', type: 'sse', baseUrl: 'https://example.com', headers })
        ).toBeUndefined()
    })

    it('distinguishes conflicting remote header aliases by their effective winner', async () => {
      await seedServer({
        type: 'sse',
        baseUrl: 'https://example.com',
        headers: { Authorization: 'one', authorization: 'two' }
      })
      expect(
        mcpServerService.findByConfig({
          name: 'test-server',
          type: 'sse',
          baseUrl: 'https://example.com',
          headers: { authorization: 'two', Authorization: 'one' }
        })
      ).toBeUndefined()
    })

    it('does not merge distinct stdio launch inputs or credentials', async () => {
      await seedServer({ env: config.env })
      const changes: Partial<Parameters<typeof mcpServerService.findByConfig>[0]>[] = [
        { name: 'other' },
        { type: 'sse' as const },
        { command: 'other' },
        { args: ['my-server', '-y'] },
        { args: [' -y', 'my-server'] },
        { env: { API_KEY: 'other', OTHER: 'x' } },
        { env: { API_KEY: 'test' } },
        { env: { API_KEY: 'test', OTHER: '' } },
        { registryUrl: 'other' },
        { dxtPath: 'other' }
      ]
      for (const change of changes) expect(mcpServerService.findByConfig({ ...config, ...change })).toBeUndefined()
    })

    it('does not merge distinct remote endpoints or transports', async () => {
      await seedServer({ type: 'sse', baseUrl: 'https://example.com/a?q=1' })
      for (const change of [
        { type: 'streamableHttp' as const, baseUrl: 'https://example.com/a?q=1' },
        { type: 'sse' as const, baseUrl: 'https://example.com/b?q=1' },
        { type: 'sse' as const, baseUrl: 'https://example.com/a?q=2' }
      ])
        expect(mcpServerService.findByConfig({ name: 'test-server', ...change })).toBeUndefined()
    })

    it('ignores fields unused by the selected transport without overwriting them', async () => {
      await seedServer({ type: 'sse', baseUrl: 'https://example.com', registryUrl: 'old', dxtPath: 'old' })
      const before = dbh.db.select().from(mcpServerTable).all()
      expect(
        mcpServerService.findByConfig({
          name: 'test-server',
          type: 'sse',
          baseUrl: 'https://example.com',
          command: 'different'
        })?.id
      ).toBe('srv-1')
      expect(dbh.db.select().from(mcpServerTable).all()).toEqual(before)
      dbh.db
        .update(mcpServerTable)
        .set({ type: 'stdio', baseUrl: null, headers: { Authorization: 'old' }, registryUrl: null, dxtPath: null })
        .run()
      expect(
        mcpServerService.findByConfig({
          name: 'test-server',
          type: 'stdio',
          command: 'npx',
          args: ['-y', 'my-server'],
          env: { API_KEY: 'test' },
          headers: { authorization: 'different' }
        })?.id
      ).toBe('srv-1')
    })

    it('matches absent transport and empty optional values according to runtime defaults', async () => {
      await seedServer({ type: null, args: null, env: null, command: '' })
      expect(
        mcpServerService.findByConfig({ name: 'test-server', type: 'stdio', args: [], env: {}, command: '' })?.id
      ).toBe('srv-1')
      dbh.db.update(mcpServerTable).set({ baseUrl: 'https://example.com' }).run()
      expect(
        mcpServerService.findByConfig({ name: 'test-server', type: 'sse', baseUrl: 'https://example.com' })?.id
      ).toBe('srv-1')
      expect(
        mcpServerService.findByConfig({ name: 'test-server', type: 'streamableHttp', baseUrl: 'https://example.com' })
      ).toBeUndefined()
      expect(mcpServerService.findByConfig({ name: 'test-server', type: 'stdio', baseUrl: '' })).toBeUndefined()
    })

    it('preserves the Windows PATH alias winner when comparing environment records', async () => {
      const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')!
      try {
        Object.defineProperty(process, 'platform', { value: 'win32' })
        await seedServer({ env: { Path: 'one', PATH: 'two', API_KEY: 'test' } })
        const query = (env: Record<string, string>) =>
          mcpServerService.findByConfig({
            name: 'test-server',
            type: 'stdio',
            command: 'npx',
            args: ['-y', 'my-server'],
            env
          })
        expect(query({ API_KEY: 'test', Path: 'one', PATH: 'two' })?.id).toBe('srv-1')
        expect(query({ API_KEY: 'test', PATH: 'two', Path: 'one' })).toBeUndefined()
      } finally {
        Object.defineProperty(process, 'platform', descriptor)
      }
    })

    it('searches all same-name candidates and chooses the oldest matching definition', async () => {
      await seedServer({ id: 'first', command: 'other' })
      await seedServer({ id: 'second', env: config.env })
      expect(mcpServerService.findByConfig(config)?.id).toBe('second')
      await seedServer({ id: 'a-match', env: config.env, createdAt: 0, sortOrder: 100, isActive: false })
      await seedServer({ id: 'b-match', env: config.env, createdAt: 0, sortOrder: -1, isActive: true })
      expect(mcpServerService.findByConfig(config)?.id).toBe('a-match')
      expect(dbh.db.select().from(mcpServerTable).all()).toHaveLength(4)
    })

    it('reuses ordinary definitions across source and state differences but excludes builtins', async () => {
      await seedServer({ env: config.env, installSource: 'builtin' })
      expect(mcpServerService.findByConfig(config)).toBeUndefined()
      for (const installSource of ['manual', 'protocol', 'ai_assisted', 'unknown', null] as const) {
        dbh.db.update(mcpServerTable).set({ installSource, isActive: true }).run()
        expect(mcpServerService.findByConfig(config)?.id).toBe('srv-1')
      }
      dbh.db.update(mcpServerTable).set({ type: 'inMemory' }).run()
      expect(mcpServerService.findByConfig(config)).toBeUndefined()
    })

    it('returns undefined without writing when no matching definition exists', async () => {
      expect(mcpServerService.findByConfig(config)).toBeUndefined()
      await seedServer({ command: 'other' })
      expect(mcpServerService.findByConfig(config)).toBeUndefined()
      expect(dbh.db.select().from(mcpServerTable).all()).toHaveLength(1)
    })
  })

  describe('getById', () => {
    it('should return a server when found', async () => {
      await seedServer()

      const result = mcpServerService.getById('srv-1')
      expect(result.id).toBe('srv-1')
      expect(result.name).toBe('test-server')
      expect(result.isActive).toBe(false)
      expect(typeof result.createdAt).toBe('string')
    })

    it('should throw NOT_FOUND when server does not exist', () => {
      let err: unknown
      try {
        mcpServerService.getById('non-existent')
      } catch (e) {
        err = e
      }
      expect(err).toBeInstanceOf(DataApiError)
      expect(err).toMatchObject({ code: ErrorCode.NOT_FOUND })
    })
  })

  describe('list', () => {
    it('should return all servers when no filters', async () => {
      await seedServer({ id: 'srv-1', name: 'first' })
      await seedServer({ id: 'srv-2', name: 'second' })

      const result = mcpServerService.list({})
      expect(result.items).toHaveLength(2)
      expect(result.total).toBe(2)
    })

    it('should filter by isActive', async () => {
      await seedServer({ id: 'srv-a', isActive: true })
      await seedServer({ id: 'srv-b', isActive: false })

      const result = mcpServerService.list({ isActive: true })
      expect(result.items).toHaveLength(1)
      expect(result.items[0].isActive).toBe(true)
    })

    it('should filter by type', async () => {
      await seedServer({ id: 'srv-stdio', type: 'stdio' })
      await seedServer({ id: 'srv-sse', type: 'sse' })

      const result = mcpServerService.list({ type: 'sse' })
      expect(result.items).toHaveLength(1)
      expect(result.items[0].type).toBe('sse')
    })
  })

  describe('create', () => {
    it('should create and return server', async () => {
      const result = mcpServerService.create({ name: 'test-server', command: 'npx' })
      expect(result.name).toBe('test-server')

      const rows = await dbh.db.select().from(mcpServerTable)
      expect(rows).toHaveLength(1)
    })

    it('should throw validation error when name is empty', () => {
      let err: unknown
      try {
        mcpServerService.create({ name: '' })
      } catch (e) {
        err = e
      }
      expect(err).toBeInstanceOf(DataApiError)
      expect(err).toMatchObject({ code: ErrorCode.VALIDATION_ERROR })
    })

    it('should throw validation error when name is whitespace only', () => {
      expect(() => mcpServerService.create({ name: '   ' })).toThrow(DataApiError)
    })

    it('rejects an enabled QVeris server without an API key', () => {
      expect(() =>
        mcpServerService.create({
          name: '@cherry/qveris',
          type: 'inMemory',
          env: { QVERIS_API_KEY: '' },
          isActive: true
        })
      ).toThrow(DataApiError)

      expect(dbh.db.select().from(mcpServerTable).all()).toEqual([])
    })

    it('accepts an inactive ZoneFoundry built-in install without an API key', () => {
      const result = mcpServerService.create({
        name: BuiltinMcpServerNames.zonefoundry,
        type: 'streamableHttp',
        baseUrl: 'https://relay.zonefoundry.dev/mcp',
        env: { ZONEFOUNDRY_API_KEY: '' },
        shouldConfig: true,
        isActive: false,
        installSource: 'builtin',
        isTrusted: true
      })

      expect(result.name).toBe(BuiltinMcpServerNames.zonefoundry)
      expect(result.isActive).toBe(false)
    })
  })

  describe('createMany', () => {
    it('creates all servers atomically and preserves request order', () => {
      const result = mcpServerService.createMany([
        { name: 'first', command: 'uvx' },
        { name: 'second', command: 'npx' }
      ])

      expect(result.map((server) => server.name)).toEqual(['first', 'second'])
      expect(dbh.db.select().from(mcpServerTable).all()).toHaveLength(2)
    })

    it('rejects a name that already exists without inserting any batch rows', async () => {
      await seedServer({ name: 'existing' })

      expect(() =>
        mcpServerService.createMany([
          { name: 'new-server', command: 'uvx' },
          { name: 'existing', command: 'npx' }
        ])
      ).toThrow(DataApiError)

      const rows = dbh.db.select().from(mcpServerTable).all()
      expect(rows.map((row) => row.name)).toEqual(['existing'])
    })

    it('rejects duplicate names within the request without inserting any rows', () => {
      expect(() => mcpServerService.createMany([{ name: 'duplicate' }, { name: 'duplicate' }])).toThrow(DataApiError)

      expect(dbh.db.select().from(mcpServerTable).all()).toEqual([])
    })
  })

  describe('update', () => {
    it('should update and return server', async () => {
      await seedServer()

      const result = mcpServerService.update('srv-1', { name: 'updated-name' })
      expect(result.name).toBe('updated-name')

      const [row] = await dbh.db.select().from(mcpServerTable).where(eq(mcpServerTable.id, 'srv-1'))
      expect(row.name).toBe('updated-name')
    })

    it('should throw NOT_FOUND when updating non-existent server', () => {
      let err: unknown
      try {
        mcpServerService.update('non-existent', { name: 'x' })
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({ code: ErrorCode.NOT_FOUND })
    })

    it('should throw validation error when name is set to empty', async () => {
      await seedServer()

      let err: unknown
      try {
        mcpServerService.update('srv-1', { name: '' })
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({ code: ErrorCode.VALIDATION_ERROR })
    })

    it('requires an API key before enabling QVeris', async () => {
      await seedServer({ name: '@cherry/qveris', type: 'inMemory', env: { QVERIS_API_KEY: '' }, isActive: false })

      expect(() => mcpServerService.update('srv-1', { isActive: true })).toThrow(DataApiError)
      expect(mcpServerService.getById('srv-1').isActive).toBe(false)

      mcpServerService.update('srv-1', { env: { QVERIS_API_KEY: 'qveris-test-key' } })
      expect(mcpServerService.update('srv-1', { isActive: true }).isActive).toBe(true)
    })
  })

  describe('delete', () => {
    it('should delete an existing server', async () => {
      await seedServer()

      expect(mcpServerService.delete('srv-1')).toBeUndefined()

      const rows = await dbh.db.select().from(mcpServerTable)
      expect(rows).toHaveLength(0)
    })

    it('should throw NOT_FOUND when deleting non-existent server', () => {
      let err: unknown
      try {
        mcpServerService.delete('non-existent')
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({ code: ErrorCode.NOT_FOUND })
    })
  })

  describe('findByIdOrName', () => {
    it('should return server when found by id', async () => {
      await seedServer()

      const result = mcpServerService.findByIdOrName('srv-1')
      expect(result).toBeDefined()
      expect(result!.id).toBe('srv-1')
    })

    it('should fall back to name lookup when id not found', async () => {
      await seedServer({ id: 'srv-x', name: 'my-server' })

      const result = mcpServerService.findByIdOrName('my-server')
      expect(result).toBeDefined()
      expect(result!.name).toBe('my-server')
    })

    it('should return undefined when not found by id or name', async () => {
      const result = mcpServerService.findByIdOrName('non-existent')
      expect(result).toBeUndefined()
    })
  })

  describe('reorder', () => {
    it('should update sortOrder for each server in a transaction', async () => {
      await seedServer({ id: 'srv-a', name: 'A', sortOrder: 0 })
      await seedServer({ id: 'srv-b', name: 'B', sortOrder: 0 })
      await seedServer({ id: 'srv-c', name: 'C', sortOrder: 0 })

      mcpServerService.reorder(['srv-c', 'srv-a', 'srv-b'])

      const rows = await dbh.db.select().from(mcpServerTable)
      const byId = new Map(rows.map((r) => [r.id, r]))
      expect(byId.get('srv-c')!.sortOrder).toBe(0)
      expect(byId.get('srv-a')!.sortOrder).toBe(1)
      expect(byId.get('srv-b')!.sortOrder).toBe(2)
    })

    it('should handle empty array', () => {
      expect(mcpServerService.reorder([])).toBeUndefined()
    })
  })
})
