import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentMcpServerTable } from '@data/db/schemas/assistantRelations'
import { mcpServerTable } from '@data/db/schemas/mcpServer'
import { McpServerService, mcpServerService } from '@data/services/McpServerService'
import { generateOrderKeySequence } from '@data/services/utils/orderKey'
import { translateLegacyMcpToolRules } from '@shared/ai/tools/mcpToolName'
import { DataApiError, ErrorCode } from '@shared/data/api/errors'
import type { McpTool } from '@shared/types/mcp'

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

  it('should export a module-level singleton', () => {
    expect(mcpServerService).toBeInstanceOf(McpServerService)
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

    it('migrates saved denial rules onto the new key when the server is renamed', async () => {
      await seedServer({ id: 'srv-1', name: 'docs' })
      const [keyA, keyB] = generateOrderKeySequence(2)
      await dbh.db.insert(agentTable).values([
        {
          id: 'agent-1',
          type: 'chat',
          name: 'with-denial',
          instructions: '',
          orderKey: keyA,
          disabledTools: ['mcp__docs__run', 'mcp__other__run']
        },
        {
          id: 'agent-2',
          type: 'chat',
          name: 'without-denial',
          instructions: '',
          orderKey: keyB,
          disabledTools: ['mcp__other__run']
        }
      ])
      await dbh.db.insert(agentMcpServerTable).values({ agentId: 'agent-1', mcpServerId: 'srv-1' })

      mcpServerService.update('srv-1', { name: 'github' })

      const [renamed] = await dbh.db.select().from(agentTable).where(eq(agentTable.id, 'agent-1'))
      // The `docs`-keyed rule follows the rename; the cold catalog cannot prove the identity
      // fragment's raw spelling, so the name-keyed original also survives (owner-bound while
      // the released key stays unclaimed). The other server's rule is untouched.
      expect(renamed.disabledTools).toEqual(['mcp__docs__run', 'mcp__github__run', 'mcp__other__run'])
      const [untouched] = await dbh.db.select().from(agentTable).where(eq(agentTable.id, 'agent-2'))
      // agent-2 does not mount the server: a name match alone must never steal its rules.
      expect(untouched.disabledTools).toEqual(['mcp__other__run'])
    })

    it('resolves a camelized agent denial to its raw tool and Pi alias when the server is renamed', async () => {
      // Pi saves denials through `buildFunctionCallToolName`, which camelizes the raw tool:
      // server `docs` + raw `get_time` persists `mcp__docs__getTime`. Renaming onto the
      // mixed-case `GitHub` must resolve the fragment against the server's tool catalog (the
      // shared `mcp.tools.<serverId>` cache) and emit the raw spelling the SDK serves
      // (`mcp__GitHub__get_time`) plus the alias Pi resolves
      // (`buildFunctionCallToolName('GitHub', 'get_time')` = `mcp__github__getTime`).
      await seedServer({ id: 'srv-camel', name: 'docs' })
      application.get('CacheService').setShared(`mcp.tools.srv-camel`, [{ name: 'get_time' } as unknown as McpTool])
      const [keyA] = generateOrderKeySequence(1)
      await dbh.db.insert(agentTable).values({
        id: 'agent-1',
        type: 'chat',
        name: 'with-camelized-denial',
        instructions: '',
        orderKey: keyA,
        disabledTools: ['mcp__docs__getTime']
      })
      await dbh.db.insert(agentMcpServerTable).values({ agentId: 'agent-1', mcpServerId: 'srv-camel' })

      mcpServerService.update('srv-camel', { name: 'GitHub' })

      const [renamed] = await dbh.db.select().from(agentTable).where(eq(agentTable.id, 'agent-1'))
      expect(renamed.disabledTools).toEqual([
        'mcp__GitHub__getTime',
        'mcp__github__gettime',
        'mcp__GitHub__get_time',
        'mcp__github__getTime'
      ])
    })

    it('leaves rules of agents that mount a same-named sibling untouched when the unmounted server is renamed', async () => {
      // Duplicate names are accepted: `srv-a` and `srv-b` are both named `docs` and the agent
      // mounts only `srv-a`. Renaming unmounted `srv-b` must not rewrite the agent's
      // `mcp__docs__run`, which names the mounted server's tool.
      await seedServer({ id: 'srv-a', name: 'docs' })
      await seedServer({ id: 'srv-b', name: 'docs' })
      const [keyA] = generateOrderKeySequence(1)
      await dbh.db.insert(agentTable).values({
        id: 'agent-1',
        type: 'chat',
        name: 'mounts-a',
        instructions: '',
        orderKey: keyA,
        disabledTools: ['mcp__docs__run', 'mcp__other__run']
      })
      await dbh.db.insert(agentMcpServerTable).values({ agentId: 'agent-1', mcpServerId: 'srv-a' })

      mcpServerService.update('srv-b', { name: 'github' })

      const [agent] = await dbh.db.select().from(agentTable).where(eq(agentTable.id, 'agent-1'))
      expect(agent.disabledTools).toEqual(['mcp__docs__run', 'mcp__other__run'])
    })

    it('follows the post-rename allocation when the new name is reserved', async () => {
      // `skills` is a built-in key: the runtime falls back to the server id, so the saved rule
      // must follow onto `mcp__<id>__run`, not onto a name no tool will ever register under.
      await seedServer({ id: 'srv-1', name: 'docs' })
      const [keyA] = generateOrderKeySequence(1)
      await dbh.db.insert(agentTable).values({
        id: 'agent-1',
        type: 'chat',
        name: 'with-denial',
        instructions: '',
        orderKey: keyA,
        disabledTools: ['mcp__docs__run']
      })
      await dbh.db.insert(agentMcpServerTable).values({ agentId: 'agent-1', mcpServerId: 'srv-1' })

      mcpServerService.update('srv-1', { name: 'skills' })

      const [agent] = await dbh.db.select().from(agentTable).where(eq(agentTable.id, 'agent-1'))
      // The cold catalog cannot prove the identity fragment's raw spelling, so the released
      // name-keyed original also survives (owner-bound while unclaimed).
      expect(agent.disabledTools).toEqual(['mcp__docs__run', 'mcp__srv-1__run'])
    })

    it('matches runtime eligibility by excluding the in-memory browser from rename allocations', async () => {
      // The runtime never mounts the in-memory browser (agentMcpServers skips it), so it must
      // not claim an allocation key here either: with it counted, the server NAMED
      // `_cherry_browser` is displaced onto its UUID and its denial is migrated to an identity
      // the runtime never registers, re-enabling the explicitly disabled tool after reconnect.
      await seedServer({ id: 'srv-browser', name: '@cherry/browser', type: 'inMemory' })
      await seedServer({ id: 'srv-named', name: '_cherry_browser' })
      const [keyA] = generateOrderKeySequence(1)
      await dbh.db.insert(agentTable).values({
        id: 'agent-1',
        type: 'chat',
        name: 'with-browser',
        instructions: '',
        orderKey: keyA,
        disabledTools: ['mcp___cherry_browser__run']
      })
      await dbh.db.insert(agentMcpServerTable).values([
        { agentId: 'agent-1', mcpServerId: 'srv-browser' },
        { agentId: 'agent-1', mcpServerId: 'srv-named' }
      ])

      mcpServerService.update('srv-named', { name: 'docs' })

      const [agent] = await dbh.db.select().from(agentTable).where(eq(agentTable.id, 'agent-1'))
      // The named server owned `_cherry_browser` all along (the browser claims nothing), so the
      // denial follows its rename onto `docs`; the cold catalog cannot prove the identity
      // fragment's raw spelling, so the released name-keyed original also survives.
      expect(agent.disabledTools).toEqual(['mcp___cherry_browser__run', 'mcp__docs__run'])
    })

    it('reserves a mounted browser id so renaming a server onto that id keeps its own id key', async () => {
      // The runtime reserves every mounted id BEFORE skipping the in-memory browser
      // (resolveMountedAgentMcpServers), so a server renamed onto the browser's id falls back
      // to its own id there. The migration derived its reservations from the browser-filtered
      // mount list: the renamed server claimed the browser's id and the denial moved onto
      // `mcp__srv-browser__run` — an identity no runtime ever registers — re-enabling the
      // explicitly disabled tool after reconnect.
      await seedServer({ id: 'srv-browser', name: '@cherry/browser', type: 'inMemory' })
      await seedServer({ id: 'srv-s', name: 'docs' })
      const [keyA] = generateOrderKeySequence(1)
      await dbh.db.insert(agentTable).values({
        id: 'agent-1',
        type: 'chat',
        name: 'renamed-onto-browser-id',
        instructions: '',
        orderKey: keyA,
        disabledTools: ['mcp__docs__run']
      })
      await dbh.db.insert(agentMcpServerTable).values([
        { agentId: 'agent-1', mcpServerId: 'srv-browser' },
        { agentId: 'agent-1', mcpServerId: 'srv-s' }
      ])

      mcpServerService.update('srv-s', { name: 'srv-browser' })

      const [agent] = await dbh.db.select().from(agentTable).where(eq(agentTable.id, 'agent-1'))
      // The browser's id is reserved in the post-rename allocation, so the server keeps its own
      // id key and the denial follows onto the identity the runtime actually registers. The
      // cold catalog cannot prove the identity fragment's raw spelling, so the released
      // name-keyed original also survives (owner-bound while unclaimed).
      expect(agent.disabledTools).toEqual(['mcp__docs__run', 'mcp__srv-s__run'])
    })

    it('copies lossy-hashed rules onto the new lossy base when a normalized name is renamed', async () => {
      // `Old server` registers lossy (`mcp__oldServer__run_<hash>`); the hash binds the old
      // name, so the rename copies the entry onto the new lossy base and keeps the original.
      await seedServer({ id: 'srv-1', name: 'Old server' })
      const [keyA] = generateOrderKeySequence(1)
      await dbh.db.insert(agentTable).values({
        id: 'agent-1',
        type: 'chat',
        name: 'with-denial',
        instructions: '',
        orderKey: keyA,
        disabledTools: ['mcp__oldServer__run_4f7413c24ae4']
      })
      await dbh.db.insert(agentMcpServerTable).values({ agentId: 'agent-1', mcpServerId: 'srv-1' })

      mcpServerService.update('srv-1', { name: 'New server' })

      const [agent] = await dbh.db.select().from(agentTable).where(eq(agentTable.id, 'agent-1'))
      expect(agent.disabledTools).toEqual([
        'mcp__oldServer__run_4f7413c24ae4',
        'mcp__newServer__run_4f7413c24ae4',
        'mcp__New_server__run_4f7413c24ae4',
        // The tail can also be a plain literal tool name, so the complete literal destination
        // (Pi's camelized-tool alias) rides along with the hashed copies.
        'mcp__newServer__run4f7413c24ae4'
      ])
    })

    it('keeps a denial that doubles as another mounted server native Pi identity through a rename', async () => {
      // A's configured name equals B's id in Pi's registered segment form (hyphens underscored):
      // A claims that key, B registers natively under `mcp__<b id underscored>__run`, and the
      // saved denial for B spells exactly that string. Renaming A must migrate A's rule while
      // retaining B's identity — interpreting the string as A's old-name rule alone would drop
      // it and re-enable B's tool on Pi after reconnect.
      const idB = 'cccccccc-dddd-4eee-8fff-000000000000'
      const piForm = idB.replace(/-/g, '_')
      await seedServer({ id: 'srv-a', name: piForm })
      await seedServer({ id: idB, name: 'bee' })
      const [keyA] = generateOrderKeySequence(1)
      await dbh.db.insert(agentTable).values({
        id: 'agent-1',
        type: 'chat',
        name: 'with-native-denial',
        instructions: '',
        orderKey: keyA,
        disabledTools: [`mcp__${piForm}__run`]
      })
      await dbh.db.insert(agentMcpServerTable).values([
        { agentId: 'agent-1', mcpServerId: 'srv-a' },
        { agentId: 'agent-1', mcpServerId: idB }
      ])

      mcpServerService.update('srv-a', { name: 'other' })

      const [agent] = await dbh.db.select().from(agentTable).where(eq(agentTable.id, 'agent-1'))
      // B's native identity survives alongside A's migrated configured-name rule.
      expect(agent.disabledTools).toEqual([`mcp__${piForm}__run`, 'mcp__other__run'])
    })

    it('emits the SDK-normalized identity when a rename destination needs underscoring', async () => {
      // Renaming to `Docs MCP` must persist the identity the SDK actually invokes
      // (`mcp__Docs_MCP__run`, spaces underscored) alongside the raw-key and camelized forms,
      // or the previously disabled tool reconnects unblocked.
      await seedServer({ id: 'srv-1', name: 'docs' })
      const [keyA] = generateOrderKeySequence(1)
      await dbh.db.insert(agentTable).values({
        id: 'agent-1',
        type: 'chat',
        name: 'with-denial',
        instructions: '',
        orderKey: keyA,
        disabledTools: ['mcp__docs__run']
      })
      await dbh.db.insert(agentMcpServerTable).values({ agentId: 'agent-1', mcpServerId: 'srv-1' })

      mcpServerService.update('srv-1', { name: 'Docs MCP' })

      const [agent] = await dbh.db.select().from(agentTable).where(eq(agentTable.id, 'agent-1'))
      // The cold catalog cannot prove the identity fragment's raw spelling, so the released
      // name-keyed original also survives alongside the SDK-normalized identity.
      expect(agent.disabledTools).toEqual(['mcp__docs__run', 'mcp__Docs_MCP__run', 'mcp__docsMcp__run'])
    })

    it('keeps an explicitly submitted disabledTools list on a combined rename update', async () => {
      // A PATCH carrying both name and disabledTools owns the list: migrating the stored rules
      // over it would silently discard the requested denial.
      await seedServer({ id: 'srv-1', name: 'docs', disabledTools: ['mcp__docs__run'] })
      const [keyA] = generateOrderKeySequence(1)
      await dbh.db.insert(agentTable).values({
        id: 'agent-1',
        type: 'chat',
        name: 'with-denial',
        instructions: '',
        orderKey: keyA,
        disabledTools: ['mcp__docs__run']
      })
      await dbh.db.insert(agentMcpServerTable).values({ agentId: 'agent-1', mcpServerId: 'srv-1' })

      mcpServerService.update('srv-1', { name: 'github', disabledTools: ['delete'] })

      const [server] = await dbh.db.select().from(mcpServerTable).where(eq(mcpServerTable.id, 'srv-1'))
      expect(server.disabledTools).toEqual(['delete'])
      // Agent-mounted rules still follow the rename — the submitted list only owns the server's
      // own field. The cold catalog cannot prove the identity fragment's raw spelling, so the
      // released name-keyed original also survives.
      const [agent] = await dbh.db.select().from(agentTable).where(eq(agentTable.id, 'agent-1'))
      expect(agent.disabledTools).toEqual(['mcp__docs__run', 'mcp__github__run'])
    })

    it('lets an explicit empty disabledTools list clear the server rules on a combined rename update', async () => {
      await seedServer({ id: 'srv-1', name: 'docs', disabledTools: ['mcp__docs__run'] })

      mcpServerService.update('srv-1', { name: 'github', disabledTools: [] })

      const [server] = await dbh.db.select().from(mcpServerTable).where(eq(mcpServerTable.id, 'srv-1'))
      expect(server.disabledTools).toEqual([])
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

    it('migrates denial rules onto the departing server id before a same-named sibling inherits the key', async () => {
      // A and B are both named `docs`; A mounts first and owns the key, so disabling A.run
      // saved `mcp__docs__run`. Deleting A removes its association — if the removal releases
      // the key without applying the allocation migration, B inherits `docs` and A's
      // restriction denies B's previously enabled tool. The removal must migrate the saved
      // rules transactionally, exactly like the ordinary mount-update path.
      await seedServer({ id: 'srv-a', name: 'docs' })
      await seedServer({ id: 'srv-b', name: 'docs' })
      const [keyA] = generateOrderKeySequence(1)
      await dbh.db.insert(agentTable).values({
        id: 'agent-1',
        type: 'chat',
        name: 'with-denial',
        instructions: '',
        orderKey: keyA,
        disabledTools: ['mcp__docs__run', 'mcp__other__run']
      })
      await dbh.db.insert(agentMcpServerTable).values([
        { agentId: 'agent-1', mcpServerId: 'srv-a', createdAt: 1000 },
        { agentId: 'agent-1', mcpServerId: 'srv-b', createdAt: 1001 }
      ])

      mcpServerService.delete('srv-a')

      const [agent] = await dbh.db.select().from(agentTable).where(eq(agentTable.id, 'agent-1'))
      // A's denial follows A onto its stable id; the unrelated rule is untouched. The cold
      // catalog cannot produce an enforceable replacement, so the name-keyed original also
      // survives the takeover: it re-enforces A's denial on a remount and over-blocks B's
      // same-camelization `run` (fail-closed) instead of letting the disabled tool execute.
      expect(agent.disabledTools).toEqual(['mcp__docs__run', 'mcp__srv-a__run', 'mcp__other__run'])
      // Enforcement seam: B inherits the `docs` key after the deletion, and the kept alias —
      // the only spelling a cold catalog leaves enforceable — binds B's same-camelization tool
      // (fail-closed over-block).
      const denied = translateLegacyMcpToolRules(agent.disabledTools, new Map([['srv-b', 'docs']]))
      expect(denied).toContain('mcp__docs__run')
      expect(denied).toContain('mcp__srv-a__run')
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
