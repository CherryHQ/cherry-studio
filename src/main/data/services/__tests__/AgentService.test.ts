import { agentTable } from '@data/db/schemas/agent'
import { agentMcpServerTable } from '@data/db/schemas/assistantRelations'
import { mcpServerTable } from '@data/db/schemas/mcpServer'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { agentService } from '@data/services/AgentService'
import { mcpServerService } from '@data/services/McpServerService'
import { pinService } from '@data/services/PinService'
import { generateOrderKeyBetween, generateOrderKeySequence } from '@data/services/utils/orderKey'
import { ErrorCode } from '@shared/data/api'
import { createUniqueModelId } from '@shared/data/types/model'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@main/apiServer/services/mcp', () => ({
  mcpApiService: {
    getServerInfo: vi.fn()
  }
}))

vi.mock('@main/apiServer/utils', () => ({
  validateModelId: vi.fn()
}))

vi.mock('@main/apiServer/services/models', () => ({
  modelsService: {
    getModels: vi.fn()
  }
}))

vi.mock('@main/ai/skills/SkillService', () => ({
  skillService: {
    initSkillsForAgent: vi.fn()
  }
}))

// Mock workspace seeding — filesystem ops not needed in unit tests
vi.mock('@main/ai/agents/cherryclaw/seedWorkspace', () => ({
  seedWorkspaceTemplates: vi.fn()
}))

describe('AgentService', () => {
  const dbh = setupTestDatabase()
  const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

  // Seed a user_model row whose id is the canonical FK form, so createAgent
  // calls with `model: <canonical id>` satisfy the FK.
  const TEST_MODEL_ID = 'anthropic::claude-3-5-sonnet'
  beforeEach(async () => {
    await dbh.db
      .insert(userProviderTable)
      .values({ providerId: 'anthropic', name: 'anthropic', orderKey: generateOrderKeyBetween(null, null) })
      .onConflictDoNothing()
    await dbh.db
      .insert(userModelTable)
      .values({
        id: TEST_MODEL_ID,
        providerId: 'anthropic',
        modelId: 'claude-3-5-sonnet',
        name: 'claude-3-5-sonnet',
        orderKey: generateOrderKeyBetween(null, null)
      })
      .onConflictDoNothing()
  })

  async function insertAgent(
    overrides: Partial<typeof agentTable.$inferInsert> & { mcps?: string[] } = {}
  ): Promise<{ id: string }> {
    const id = overrides.id ?? `agent_test_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
    const { mcps, ...rest } = overrides
    const base: typeof agentTable.$inferInsert = {
      type: 'claude-code',
      name: 'Test Agent',
      instructions: 'You are a helpful assistant.',
      // FK to user_model.id; tests insert NULL since they don't exercise model behavior.
      model: null,
      orderKey: 'a0',
      ...rest,
      id
    }
    await dbh.db.insert(agentTable).values(base)
    // Insert junction rows for MCP associations
    if (mcps && mcps.length > 0) {
      await dbh.db.insert(agentMcpServerTable).values(mcps.map((mcpId) => ({ agentId: id, mcpServerId: mcpId })))
    }
    return { id }
  }

  async function seedModelRefs() {
    await dbh.db
      .insert(userProviderTable)
      .values({
        providerId: 'anthropic',
        name: 'Anthropic',
        orderKey: generateOrderKeyBetween(null, null)
      })
      .onConflictDoNothing()
    await dbh.db
      .insert(userModelTable)
      .values({
        id: createUniqueModelId('anthropic', 'claude-sonnet-4-5'),
        providerId: 'anthropic',
        modelId: 'claude-sonnet-4-5',
        presetModelId: 'claude-sonnet-4-5',
        name: 'Claude Sonnet 4.5',
        isEnabled: true,
        isHidden: false,
        orderKey: generateOrderKeyBetween(null, null)
      })
      .onConflictDoNothing()
  }

  async function insertMcpServer(id: string, name?: string): Promise<void> {
    await dbh.db
      .insert(mcpServerTable)
      .values({ id, name: name ?? id, sortOrder: 0, isActive: false })
      .onConflictDoNothing()
  }

  describe('createAgent', () => {
    it('generates a UUID v4 agent ID', async () => {
      const agent = await agentService.createAgent({
        type: 'claude-code',
        name: 'UUID ID Test',
        model: TEST_MODEL_ID
      })

      expect(agent.id).toMatch(uuidV4Pattern)
    })

    it('persists plan and small models when provided', async () => {
      const agent = await agentService.createAgent({
        type: 'claude-code',
        name: 'Model Roles Test',
        model: TEST_MODEL_ID,
        planModel: TEST_MODEL_ID,
        smallModel: TEST_MODEL_ID
      })

      expect(agent).toMatchObject({
        model: TEST_MODEL_ID,
        planModel: TEST_MODEL_ID,
        smallModel: TEST_MODEL_ID
      })
    })

    it('places newly created agents by default orderKey sort', async () => {
      await insertAgent({ id: 'agent_existing_a' })
      await insertAgent({ id: 'agent_existing_b' })

      const created = await agentService.createAgent({
        type: 'claude-code',
        name: 'Newest',
        model: TEST_MODEL_ID
      })

      const { agents } = await agentService.listAgents()
      expect(agents.at(-1)?.id).toBe(created.id)
    })

    it('defaults disabledTools to an empty array (opt-out, backward-safe)', async () => {
      const agent = await agentService.createAgent({
        type: 'claude-code',
        name: 'Disabled Tools Default',
        model: TEST_MODEL_ID
      })
      const reloaded = await agentService.getAgent(agent.id)
      expect(reloaded?.disabledTools).toEqual([])
    })
  })

  describe('disabledTools round-trip', () => {
    it('persists disabledTools on create and update', async () => {
      const created = await agentService.createAgent({
        type: 'claude-code',
        name: 'Disabled Tools',
        model: TEST_MODEL_ID,
        disabledTools: ['Bash']
      })
      expect(created.disabledTools).toEqual(['Bash'])

      const updated = await agentService.updateAgent(created.id, { disabledTools: ['Bash', 'Workflow'] })
      expect(updated?.disabledTools).toEqual(['Bash', 'Workflow'])

      const reloaded = await agentService.getAgent(created.id)
      expect(reloaded?.disabledTools).toEqual(['Bash', 'Workflow'])
    })
  })

  describe('mcps round-trip', () => {
    it('persists mcps on create through the service', async () => {
      await insertMcpServer('mcp_a')
      await insertMcpServer('mcp_b')

      const created = await agentService.createAgent({
        type: 'claude-code',
        name: 'MCP Create',
        model: TEST_MODEL_ID,
        mcps: ['mcp_a', 'mcp_b']
      })
      expect([...(created.mcps ?? [])].sort()).toEqual(['mcp_a', 'mcp_b'])

      const reloaded = await agentService.getAgent(created.id)
      expect([...(reloaded?.mcps ?? [])].sort()).toEqual(['mcp_a', 'mcp_b'])
    })

    it('replaces mcps when update provides a new array', async () => {
      await insertMcpServer('mcp_a')
      await insertMcpServer('mcp_b')
      await insertMcpServer('mcp_c')
      const created = await agentService.createAgent({
        type: 'claude-code',
        name: 'MCP Replace',
        model: TEST_MODEL_ID,
        mcps: ['mcp_a', 'mcp_b']
      })

      const updated = await agentService.updateAgent(created.id, { mcps: ['mcp_c'] })
      expect(updated?.mcps).toEqual(['mcp_c'])

      const reloaded = await agentService.getAgent(created.id)
      expect(reloaded?.mcps).toEqual(['mcp_c'])
    })

    // Load-bearing: the `if (newMcps !== undefined)` guard in updateAgent. If it
    // ever regressed to an unconditional delete, every unrelated update (e.g. a
    // rename) would wipe an agent's MCP servers — the exact data-loss class this
    // PR fixes.
    it('preserves existing mcps when update omits the field', async () => {
      await insertMcpServer('mcp_a')
      const created = await agentService.createAgent({
        type: 'claude-code',
        name: 'MCP Preserve',
        model: TEST_MODEL_ID,
        mcps: ['mcp_a']
      })

      const updated = await agentService.updateAgent(created.id, { name: 'Renamed' })
      expect(updated?.name).toBe('Renamed')
      expect(updated?.mcps).toEqual(['mcp_a'])

      const reloaded = await agentService.getAgent(created.id)
      expect(reloaded?.mcps).toEqual(['mcp_a'])
    })

    it('clears mcps when update passes an empty array', async () => {
      await insertMcpServer('mcp_a')
      const created = await agentService.createAgent({
        type: 'claude-code',
        name: 'MCP Clear',
        model: TEST_MODEL_ID,
        mcps: ['mcp_a']
      })

      const updated = await agentService.updateAgent(created.id, { mcps: [] })
      expect(updated?.mcps).toEqual([])

      const reloaded = await agentService.getAgent(created.id)
      expect(reloaded?.mcps).toEqual([])
    })
  })

  describe('deleteAgent', () => {
    it('hard-deletes an agent and removes the row', async () => {
      const { id } = await insertAgent({ id: 'agent_regular_test_001' })

      const deleted = await agentService.deleteAgent(id)

      expect(deleted).toBe(true)
      const rows = await dbh.db.select().from(agentTable)
      expect(rows.find((r) => r.id === id)).toBeUndefined()
    })

    it('purges agent pins on delete (pin table has no FK)', async () => {
      const { id } = await insertAgent({ id: 'agent_with_pin_001' })
      const otherAgent = await insertAgent({ id: 'agent_other_002' })
      await pinService.pin({ entityType: 'agent', entityId: id })
      const otherPin = await pinService.pin({ entityType: 'agent', entityId: otherAgent.id })

      await agentService.deleteAgent(id)

      const remaining = await pinService.listByEntityType('agent')
      expect(remaining.map((p) => p.entityId)).toEqual([otherPin.entityId])
    })
  })

  describe('McpServerService.delete() cascade', () => {
    it('removes a deleted MCP server and cascade-removes references from all agents', async () => {
      const mcpId = 'mcp_to_delete'
      await insertMcpServer(mcpId)
      await insertMcpServer('mcp_keep')
      await insertAgent({ id: 'agent_with_mcp_1', mcps: [mcpId, 'mcp_keep'] })
      await insertAgent({ id: 'agent_with_mcp_2', mcps: [mcpId] })
      await insertAgent({ id: 'agent_without_mcp', mcps: ['mcp_keep'] })

      const events: Array<{ agentId: string; mcps: string[] }> = []
      const disposable = agentService.onAgentUpdated((e) => {
        if (e.updates.mcps) events.push({ agentId: e.agentId, mcps: e.updates.mcps })
      })

      await mcpServerService.delete(mcpId)

      // MCP server row should be deleted
      const remainingMcps = await dbh.db.select().from(mcpServerTable).where(eq(mcpServerTable.id, mcpId))
      expect(remainingMcps).toHaveLength(0)

      const agent1 = await agentService.getAgent('agent_with_mcp_1')
      const agent2 = await agentService.getAgent('agent_with_mcp_2')
      const agent3 = await agentService.getAgent('agent_without_mcp')

      expect(agent1?.mcps).toEqual(['mcp_keep'])
      expect(agent2?.mcps).toEqual([])
      expect(agent3?.mcps).toEqual(['mcp_keep'])

      expect(events).toHaveLength(2)
      expect(events.find((e) => e.agentId === 'agent_with_mcp_1')?.mcps).toEqual(['mcp_keep'])
      expect(events.find((e) => e.agentId === 'agent_with_mcp_2')?.mcps).toEqual([])

      disposable.dispose()
    })

    it('emits no events when no agents reference the deleted MCP', async () => {
      await insertMcpServer('mcp_alone')
      await insertMcpServer('mcp_other')
      await insertAgent({ id: 'agent_no_ref', mcps: ['mcp_other'] })

      const events: Array<{ agentId: string; mcps: string[] }> = []
      const disposable = agentService.onAgentUpdated((e) => {
        if (e.updates.mcps) events.push({ agentId: e.agentId, mcps: e.updates.mcps })
      })

      await mcpServerService.delete('mcp_alone')

      const agent = await agentService.getAgent('agent_no_ref')
      expect(agent?.mcps).toEqual(['mcp_other'])

      expect(events).toHaveLength(0)

      disposable.dispose()
    })

    it('handles agents with empty mcps arrays gracefully', async () => {
      await insertMcpServer('mcp_standalone')
      await insertAgent({ id: 'agent_empty_mcps' })

      const events: Array<{ agentId: string; mcps: string[] }> = []
      const disposable = agentService.onAgentUpdated((e) => {
        if (e.updates.mcps) events.push({ agentId: e.agentId, mcps: e.updates.mcps })
      })

      await mcpServerService.delete('mcp_standalone')

      const agent = await agentService.getAgent('agent_empty_mcps')
      expect(agent?.mcps).toEqual([])

      expect(events).toHaveLength(0)

      disposable.dispose()
    })
  })

  describe('listAgents', () => {
    it('respects limit and offset', async () => {
      for (let i = 0; i < 5; i++) {
        await insertAgent({ name: `Agent ${i}` })
      }

      const page1 = await agentService.listAgents({ limit: 2, offset: 0 })
      const page2 = await agentService.listAgents({ limit: 2, offset: 2 })

      expect(page1.agents).toHaveLength(2)
      expect(page2.agents).toHaveLength(2)
      expect(page1.total).toBe(5)
      // Pages should not overlap
      const ids1 = page1.agents.map((a) => a.id)
      const ids2 = page2.agents.map((a) => a.id)
      expect(ids1.some((id) => ids2.includes(id))).toBe(false)
    })

    it('sorts by name ascending when sortBy=name and sortOrder=asc', async () => {
      await insertAgent({ name: 'Zebra' })
      await insertAgent({ name: 'Alpha' })
      await insertAgent({ name: 'Mango' })

      const { agents } = await agentService.listAgents({ sortBy: 'name', sortOrder: 'asc' })

      const names = agents.map((a) => a.name)
      expect(names).toEqual([...names].sort())
    })

    it('sorts unpinned agents by orderKey by default', async () => {
      await insertAgent({ id: 'agent_order_c', name: 'C', orderKey: 'c' })
      await insertAgent({ id: 'agent_order_a', name: 'A', orderKey: 'a' })
      await insertAgent({ id: 'agent_order_b', name: 'B', orderKey: 'b' })

      const { agents } = await agentService.listAgents()

      expect(agents.map((agent) => agent.id)).toEqual(['agent_order_a', 'agent_order_b', 'agent_order_c'])
    })

    it('surfaces pinned agents ahead of unpinned agents under the default orderKey sort', async () => {
      await insertAgent({ id: 'agent_pin_a', name: 'A', orderKey: 'a' })
      await insertAgent({ id: 'agent_pin_b', name: 'B', orderKey: 'b' })
      await insertAgent({ id: 'agent_pin_c', name: 'C', orderKey: 'c' })
      await pinService.pin({ entityType: 'agent', entityId: 'agent_pin_c' })
      await pinService.pin({ entityType: 'agent', entityId: 'agent_pin_b' })

      const { agents } = await agentService.listAgents()

      expect(agents.map((agent) => agent.id)).toEqual(['agent_pin_c', 'agent_pin_b', 'agent_pin_a'])
    })

    it('orders rows with equal updatedAt by id using the requested direction (tiebreaker)', async () => {
      await insertAgent({ id: 'agent_aaa', name: 'A', updatedAt: 5000, createdAt: 5000 })
      await insertAgent({ id: 'agent_zzz', name: 'Z', updatedAt: 5000, createdAt: 5000 })

      const { agents } = await agentService.listAgents({ sortBy: 'updatedAt', sortOrder: 'desc' })

      const ids = agents.map((a) => a.id)
      expect(ids.indexOf('agent_zzz')).toBeLessThan(ids.indexOf('agent_aaa'))
    })

    it('sorts by updatedAt without pin-first ordering', async () => {
      await insertAgent({ id: 'agent_updated_old', name: 'Old', updatedAt: 100, createdAt: 100 })
      await insertAgent({ id: 'agent_updated_new', name: 'New', updatedAt: 200, createdAt: 200 })
      await pinService.pin({ entityType: 'agent', entityId: 'agent_updated_old' })

      const { agents } = await agentService.listAgents({ sortBy: 'updatedAt', sortOrder: 'desc' })

      expect(agents.map((agent) => agent.id).slice(0, 2)).toEqual(['agent_updated_new', 'agent_updated_old'])
    })

    it('does not expose tags in agent rows', async () => {
      const { id: taggedId } = await insertAgent({ id: 'agent_tag_test_1', name: 'tagged' })
      const { id: untaggedId } = await insertAgent({ id: 'agent_tag_test_2', name: 'untagged' })

      const { agents } = await agentService.listAgents()

      const tagged = agents.find((agent) => agent.id === taggedId)
      const untagged = agents.find((agent) => agent.id === untaggedId)
      expect(tagged).toBeDefined()
      expect(untagged).toBeDefined()
      expect('tags' in (tagged as object)).toBe(false)
      expect('tags' in (untagged as object)).toBe(false)
    })

    it('embeds modelName resolved from user_model', async () => {
      await seedModelRefs()
      const deletedModelId = createUniqueModelId('anthropic', 'deleted-model')
      await dbh.db.insert(userModelTable).values({
        id: deletedModelId,
        providerId: 'anthropic',
        modelId: 'deleted-model',
        name: 'Deleted Model',
        orderKey: generateOrderKeyBetween(null, null)
      })

      const bound = await insertAgent({
        id: 'agent_model_test_1',
        name: 'bound',
        model: 'anthropic::claude-sonnet-4-5'
      })
      const unbound = await insertAgent({
        id: 'agent_model_test_2',
        name: 'missing',
        model: deletedModelId
      })

      // Drop the row; FK is `ON DELETE set null`, so agent.model becomes NULL.
      await dbh.db.delete(userModelTable).where(eq(userModelTable.id, deletedModelId))

      const { agents } = await agentService.listAgents()
      const byId = new Map(agents.map((agent) => [agent.id, agent]))

      expect(byId.get(bound.id)?.modelName).toBe('Claude Sonnet 4.5')
      expect(byId.get(unbound.id)?.modelName).toBeNull()
    })

    it('filters by search against name OR description', async () => {
      await insertAgent({ id: 'agent_search_1', name: 'Research Bot' })
      await insertAgent({ id: 'agent_search_2', name: 'unrelated', description: 'used for research' })
      await insertAgent({ id: 'agent_search_3', name: 'noise' })

      const { agents } = await agentService.listAgents({ search: 'research' })

      expect(agents.map((agent) => agent.id).sort()).toEqual(['agent_search_1', 'agent_search_2'])
    })
  })

  describe('search', () => {
    it('returns lean navigation items ordered by updatedAt', async () => {
      await insertAgent({
        id: 'agent_search_old',
        name: 'Needle Old Agent',
        description: 'old agent',
        configuration: { avatar: 'A' },
        updatedAt: 100
      })
      await insertAgent({
        id: 'agent_search_new',
        name: 'Needle New Agent',
        description: 'new agent',
        configuration: { avatar: 'B' },
        updatedAt: 200
      })
      await insertAgent({ id: 'agent_search_miss', name: 'Other', updatedAt: 300 })

      const result = await agentService.search({ q: 'Needle', limit: 5 })

      expect(result).toEqual([
        {
          type: 'agent',
          id: 'agent_search_new',
          title: 'Needle New Agent',
          subtitle: 'new agent',
          emoji: 'B',
          updatedAt: '1970-01-01T00:00:00.200Z',
          target: { agentId: 'agent_search_new' }
        },
        {
          type: 'agent',
          id: 'agent_search_old',
          title: 'Needle Old Agent',
          subtitle: 'old agent',
          emoji: 'A',
          updatedAt: '1970-01-01T00:00:00.100Z',
          target: { agentId: 'agent_search_old' }
        }
      ])
      expect(result[0]).not.toHaveProperty('modelName')
    })
  })

  describe('reorder', () => {
    async function listAgentIds() {
      const { agents } = await agentService.listAgents()
      return agents.map((agent) => agent.id)
    }

    it('moves a single active agent by orderKey', async () => {
      const [firstKey, secondKey, thirdKey] = generateOrderKeySequence(3)
      await insertAgent({ id: 'agent_reorder_a', name: 'A', orderKey: firstKey })
      await insertAgent({ id: 'agent_reorder_b', name: 'B', orderKey: secondKey })
      await insertAgent({ id: 'agent_reorder_c', name: 'C', orderKey: thirdKey })

      await agentService.reorder('agent_reorder_c', { before: 'agent_reorder_a' })

      expect(await listAgentIds()).toEqual(['agent_reorder_c', 'agent_reorder_a', 'agent_reorder_b'])
    })

    it('rejects a soft-deleted single target without mutating active order', async () => {
      const [firstKey, secondKey, deletedKey] = generateOrderKeySequence(3)
      await insertAgent({ id: 'agent_reorder_a', name: 'A', orderKey: firstKey })
      await insertAgent({ id: 'agent_reorder_b', name: 'B', orderKey: secondKey })
      await insertAgent({ id: 'agent_reorder_deleted', name: 'Deleted', orderKey: deletedKey, deletedAt: 123 })

      const beforeRejectedMove = await listAgentIds()
      await expect(agentService.reorder('agent_reorder_deleted', { position: 'first' })).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
      expect(await listAgentIds()).toEqual(beforeRejectedMove)
    })

    it('applies batch moves and rejects soft-deleted targets without mutating active order', async () => {
      const [firstKey, secondKey, thirdKey, deletedKey] = generateOrderKeySequence(4)
      await insertAgent({ id: 'agent_reorder_a', name: 'A', orderKey: firstKey })
      await insertAgent({ id: 'agent_reorder_b', name: 'B', orderKey: secondKey })
      await insertAgent({ id: 'agent_reorder_c', name: 'C', orderKey: thirdKey })
      await insertAgent({ id: 'agent_reorder_deleted', name: 'Deleted', orderKey: deletedKey, deletedAt: 123 })

      await agentService.reorderBatch([
        { id: 'agent_reorder_b', anchor: { position: 'first' } },
        { id: 'agent_reorder_c', anchor: { after: 'agent_reorder_b' } }
      ])
      expect(await listAgentIds()).toEqual(['agent_reorder_b', 'agent_reorder_c', 'agent_reorder_a'])

      const beforeRejectedMove = await listAgentIds()
      await expect(
        agentService.reorderBatch([
          { id: 'agent_reorder_a', anchor: { position: 'first' } },
          { id: 'agent_reorder_deleted', anchor: { position: 'last' } }
        ])
      ).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
      expect(await listAgentIds()).toEqual(beforeRejectedMove)
    })
  })
})
